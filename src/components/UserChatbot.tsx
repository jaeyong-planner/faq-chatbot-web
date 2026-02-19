import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FAQ, CustomerServiceInfo, FallbackMessageConfig } from '../types';
import { vectorSearchService, FAQ_MIN_SIMILARITY, FAQ_HIGH_CONFIDENCE, FAQ_MEDIUM_CONFIDENCE } from '../services/vectorSearchService';

import { getSupabaseDatabaseService } from '../services/supabase';
import { ChatSessionUpdateInput } from '../types';
import { useToast } from './Toast';
import { WebGeminiService } from '../services/WebGeminiService';
import { createLogger } from '../services/logger';

const log = createLogger('UserChatbot');
interface UserChatbotProps {
  faqs?: FAQ[];
  onGoToAdmin?: () => void;
  selectedFaq?: FAQ | null;
}

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
  faq?: FAQ;
  relatedImages?: Array<{
    url: string;
    description?: string;
    sourceDocument?: { id: number; name: string; filePath?: string };
  }>;
  relatedGraphs?: Array<{
    url: string;
    title?: string;
    description?: string;
    sourceDocument?: { id: number; name: string; filePath?: string };
  }>;
  relatedChunks?: Array<{
    content: string;
    pageNumber: number;
    sourceDocument?: { id: number; name: string; filePath?: string };
  }>;
  relatedDocuments?: Array<{
    id: number;
    name: string;
    filePath?: string;
  }>;
}

type LogMessagePayload = {
  sender: 'user' | 'bot';
  message: string;
  timestamp: Date;
  messageType?: 'text' | 'file' | 'image';
  responseTime?: number;
  confidence?: number;
  sourceFaq?: number;
};

const INITIAL_BOT_MESSAGE = '안녕하세요! 금융 FAQ 챗봇입니다. 궁금한 것이 있으시면 언제든 물어보세요.';

// 복합 질문 감지 함수
const COMPOUND_CONJUNCTIONS = ['그리고', '또한', '추가로', '아울러', '더불어', '함께', '뿐만 아니라'];

const detectCompoundQuestion = (text: string): boolean => {
  // 물음표가 2개 이상이면 복합 질문
  const questionMarkCount = (text.match(/\?/g) || []).length;
  if (questionMarkCount >= 2) return true;

  // 접속사로 연결된 복합 질문 감지
  for (const conj of COMPOUND_CONJUNCTIONS) {
    if (text.includes(conj)) {
      // 접속사 전후에 질문 형태가 있는지 확인
      const parts = text.split(conj);
      if (parts.length >= 2 && parts[0].trim().length > 5 && parts[1].trim().length > 5) {
        return true;
      }
    }
  }

  return false;
};

// 고객센터 기본 정보
const DEFAULT_CUSTOMER_SERVICE: CustomerServiceInfo = {
  phone: '1234-5678',
  email: 'support@embrain.com',
  operatingHours: '평일 09:00~18:00'
};

// Fallback 메시지 기본값
const DEFAULT_FALLBACK_CONFIG: FallbackMessageConfig = {
  title: '죄송합니다. 해당 질문에 대한 답변을 찾을 수 없습니다.',
  body: '아래 방법으로 도움을 받으실 수 있습니다:',
  showPhone: true,
  showEmail: true,
  showFaqGuide: true,
  additionalMessage: '',
};

/** localStorage에서 Fallback 설정을 로드하여 메시지 텍스트를 조합 */
const buildFallbackMessage = (cs: CustomerServiceInfo): string => {
  let config = DEFAULT_FALLBACK_CONFIG;
  try {
    const saved = localStorage.getItem('fallback-message-config');
    if (saved) config = { ...DEFAULT_FALLBACK_CONFIG, ...JSON.parse(saved) };
  } catch {}

  const lines: string[] = [config.title, ''];
  if (config.body) lines.push(config.body);
  if (config.showPhone) lines.push(`\u2022 고객센터 전화 문의: ${cs.phone} (${cs.operatingHours})`);
  if (config.showEmail) lines.push(`\u2022 이메일 문의: ${cs.email}`);
  if (config.showFaqGuide) lines.push(`\u2022 위의 '자주 묻는 질문'을 확인해 보세요.`);
  if (config.additionalMessage) {
    lines.push('');
    lines.push(config.additionalMessage);
  }
  return lines.join('\n');
};

// URL sanitization (XSS 방지: javascript:, data: 등 위험한 프로토콜 차단)
const sanitizeUrl = (url: string | undefined): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    if (trimmed.startsWith('/') || trimmed.startsWith('./')) return trimmed;
    return null;
  }
};

// 고객센터 플레이스홀더 치환 함수
const replaceCustomerServicePlaceholders = (text: string, cs: CustomerServiceInfo): string => {
  if (!text) return text;
  return text
    .replace(/\(전화번호\)/g, cs.phone)
    .replace(/\(이메일 주소\)/g, cs.email)
    .replace(/\(이메일\)/g, cs.email)
    .replace(/\(운영 시간\)/g, cs.operatingHours)
    .replace(/\(운영시간\)/g, cs.operatingHours)
    .replace(/\{전화번호\}/g, cs.phone)
    .replace(/\{이메일 주소\}/g, cs.email)
    .replace(/\{이메일\}/g, cs.email)
    .replace(/\{운영 시간\}/g, cs.operatingHours)
    .replace(/\{운영시간\}/g, cs.operatingHours);
};

// 마크다운 형식 제거 함수 (순수 텍스트로 변환)
const removeMarkdown = (text: string): string => {
  if (!text) return text;

  return text
    // **굵은 글씨** 제거 (먼저 처리)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // __굵은 글씨__ 제거
    .replace(/__(.*?)\__/g, '$1')
    // `코드` 제거
    .replace(/`([^`]+)`/g, '$1')
    // *기울임* 제거 (** 제거 후 처리, 단일 *만)
    .replace(/\*([^*\n]+?)\*/g, '$1')
    // _기울임_ 제거 (__ 제거 후 처리, 단일 _만, 단어 경계 고려)
    .replace(/\b_([^_\n]+?)_\b/g, '$1')
    // # 헤더 제거
    .replace(/^#+\s+/gm, '')
    // 링크 [텍스트](URL) 제거
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    // 이미지 ![alt](URL) 제거
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
    // 리스트 항목 마커 제거 (단, 내용은 유지)
    .replace(/^[\*\-\+]\s+/gm, '')
    // 번호 리스트 마커 제거 (단, 내용은 유지)
    .replace(/^\d+\.\s+/gm, '')
    // 수평선 제거
    .replace(/^---+$/gm, '')
    // 줄바꿈 정리
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const UserChatbot: React.FC<UserChatbotProps> = ({ faqs = [], onGoToAdmin, selectedFaq }) => {
  const { showToast } = useToast();
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);

  const createInitialMessage = (): Message => ({
      id: 1,
    text: INITIAL_BOT_MESSAGE,
      isUser: false,
      timestamp: new Date()
  });

  const [messages, setMessages] = useState<Message[]>([createInitialMessage()]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [featuredFAQs, setFeaturedFAQs] = useState<FAQ[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialBotMessageRef = useRef<Message>(messages[0]);
  const sessionStartRef = useRef<Date | null>(null);
  const pendingLogsRef = useRef<LogMessagePayload[]>([]);
  const messagesRef = useRef<Message[]>(messages);
  const chatSessionIdRef = useRef<string | null>(null);
  const isSessionResolvedRef = useRef<boolean>(false);
  const sessionCategoryRef = useRef<string | undefined>(undefined);
  const satisfactionRef = useRef<number | null>(null);
  const finalizeTriggeredRef = useRef<boolean>(false);

  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  const [sessionCategory, setSessionCategory] = useState<string | undefined>(undefined);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [customerServiceInfo, setCustomerServiceInfo] = useState<CustomerServiceInfo>(DEFAULT_CUSTOMER_SERVICE);

  const updateSession = useCallback(async (updates: ChatSessionUpdateInput) => {
    if (!chatSessionIdRef.current) {
      return;
    }

    try {
      await dbService.updateChatSession(chatSessionIdRef.current, updates);
    } catch (error) {
      log.error('채팅 세션 업데이트 실패:', error);
    }
  }, [dbService]);

  const persistMessage = useCallback(async (sessionId: string, payload: LogMessagePayload) => {
    try {
      await dbService.createChatMessage({
        sessionId,
        timestamp: payload.timestamp.toISOString(),
        sender: payload.sender,
        message: payload.message,
        messageType: payload.messageType || 'text',
        responseTime: payload.responseTime,
        confidence: payload.confidence,
        sourceFaq: payload.sourceFaq
      });
    } catch (error) {
      log.error('채팅 메시지 저장 실패:', error);
    }
  }, [dbService]);

  const logMessage = useCallback(async (payload: LogMessagePayload) => {
    if (!chatSessionIdRef.current) {
      pendingLogsRef.current.push(payload);
      return;
    }

    await persistMessage(chatSessionIdRef.current, payload);

    const estimatedCount = messagesRef.current.length + 1;
    await updateSession({ messageCount: estimatedCount });
  }, [persistMessage, updateSession]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load Featured FAQs
  useEffect(() => {
    const loadFeaturedFAQs = async () => {
      try {
        const featured = await dbService.getFeaturedFAQs();
        setFeaturedFAQs(featured || []);
      } catch (error) {
        log.error('Failed to load featured FAQs:', error);
      }
    };

    loadFeaturedFAQs();
  }, [dbService]);

  // 고객센터 정보 로드
  useEffect(() => {
    try {
      const saved = localStorage.getItem('customer-service-info');
      if (saved) {
        setCustomerServiceInfo(JSON.parse(saved));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatSessionIdRef.current = chatSessionId;
  }, [chatSessionId]);

  useEffect(() => {
    isSessionResolvedRef.current = isSessionResolved;
  }, [isSessionResolved]);

  useEffect(() => {
    sessionCategoryRef.current = sessionCategory;
  }, [sessionCategory]);

  useEffect(() => {
    satisfactionRef.current = satisfaction;
  }, [satisfaction]);

  useEffect(() => {
    if (!chatSessionId) {
      return;
    }

    const flushPendingLogs = async () => {
      if (pendingLogsRef.current.length === 0) {
        return;
      }

      const queued = [...pendingLogsRef.current];
      pendingLogsRef.current = [];

      for (const payload of queued) {
        await logMessage(payload);
      }
    };

    flushPendingLogs();
  }, [chatSessionId, logMessage]);

  useEffect(() => {
    finalizeTriggeredRef.current = false;
  }, [chatSessionId]);

  const formatDuration = useCallback((start: Date | null, end: Date) => {
    if (!start) return '';
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    if (minutes === 0) {
      return `${seconds}초`;
    }
    return `${minutes}분 ${seconds}초`;
  }, []);

  const finalizeSession = useCallback(async (forceStatus?: 'completed' | 'abandoned') => {
    if (finalizeTriggeredRef.current) {
      return;
    }

    if (!chatSessionIdRef.current) {
      return;
    }

    finalizeTriggeredRef.current = true;

    const endTime = new Date();
    const duration = formatDuration(sessionStartRef.current, endTime);
    const messageCount = messagesRef.current.length;
    const status = forceStatus ?? (isSessionResolvedRef.current ? 'completed' : 'abandoned');

    try {
      await dbService.updateChatSession(chatSessionIdRef.current, {
        endTime: endTime.toISOString(),
        duration,
        status,
        messageCount,
        satisfaction: satisfactionRef.current ?? undefined,
        tags: sessionCategoryRef.current ? [sessionCategoryRef.current] : undefined
      });
    } catch (error) {
      log.error('채팅 세션 종료 처리 실패:', error);
    }
  }, [dbService, formatDuration]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void finalizeSession('abandoned');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void finalizeSession();
    };
  }, [finalizeSession]);

  useEffect(() => {
    const initializeSession = async () => {
      const timestamp = new Date();
      const randomBytes = crypto.getRandomValues(new Uint8Array(8));
      const randomSuffix = Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
      const generatedSessionId = `sess_${timestamp.toISOString().replace(/[-:.TZ]/g, '')}_${randomSuffix}`;

      sessionStartRef.current = timestamp;

      try {
        await dbService.createChatSession({
          sessionId: generatedSessionId,
          startTime: timestamp.toISOString(),
          status: 'ongoing',
          user: '익명 사용자',
          userEmail: '',
          tags: [],
          isResolved: false,
          category: sessionCategoryRef.current,
          messageCount: 0
        });

        setChatSessionId(generatedSessionId);

        const initialMessage = initialBotMessageRef.current;
        if (initialMessage) {
          await persistMessage(generatedSessionId, {
            sender: 'bot',
            message: initialMessage.text,
            timestamp: initialMessage.timestamp,
            messageType: 'text'
          });
        }
      } catch (error) {
        log.error('채팅 세션 초기화 실패:', error);
      }
    };

    initializeSession();
  }, [dbService, persistMessage]);

  // updateSession의 최신 참조를 유지하되, cleanup 재등록을 방지
  const updateSessionRef = useRef(updateSession);
  updateSessionRef.current = updateSession;

  useEffect(() => {
    return () => {
      const sessionId = chatSessionIdRef.current;
      const sessionStart = sessionStartRef.current;

      if (!sessionId || !sessionStart) {
        return;
      }

      const endTime = new Date();
      const diffMs = Math.max(0, endTime.getTime() - sessionStart.getTime());
      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      const durationText = `${minutes}분 ${seconds}초`;

      const updates: ChatSessionUpdateInput = {
        endTime: endTime.toISOString(),
        status: 'completed',
        duration: durationText,
        isResolved: isSessionResolvedRef.current,
        category: sessionCategoryRef.current,
        messageCount: messagesRef.current.length
      };

      updateSessionRef.current(updates);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedFaq) {
      return;
    }

    const addTestConversation = async () => {
      try {
        const userTimestamp = new Date();
      const testMessage: Message = {
        id: Date.now(),
        text: selectedFaq.question,
        isUser: true,
          timestamp: userTimestamp
      };

        const botTimestamp = new Date();
      const botResponse: Message = {
        id: Date.now() + 1,
        text: replaceCustomerServicePlaceholders(selectedFaq.answer, customerServiceInfo),
        isUser: false,
          timestamp: botTimestamp,
        faq: selectedFaq
      };

      setMessages(prev => [...prev, testMessage, botResponse]);

        await logMessage({
          sender: 'user',
          message: testMessage.text,
          timestamp: testMessage.timestamp,
          messageType: 'text'
        });

        await logMessage({
          sender: 'bot',
          message: botResponse.text,
          timestamp: botResponse.timestamp,
          messageType: 'text',
          sourceFaq: selectedFaq.id,
          responseTime: botTimestamp.getTime() - userTimestamp.getTime()
        });

        setSessionCategory(selectedFaq.category);
        setIsSessionResolved(true);
        await updateSession({
          category: selectedFaq.category,
          isResolved: true
        });
      } catch (error) {
        log.error('선택 FAQ 대화 기록 추가 실패:', error);
      }
    };

    addTestConversation();
  }, [selectedFaq, logMessage, updateSession, customerServiceInfo]);

  const findBestMatch = async (query: string): Promise<FAQ | null> => {
    try {
      // 벡터 서치 사용 (우선순위 높음)
      const bestFAQ = await vectorSearchService.findBestFAQ(query);
      if (bestFAQ) {
        return bestFAQ;
      }

      // Fallback: 키워드 매칭
    const activeFaqs = faqs.filter(faq => faq.isActive);
    const matches = activeFaqs.filter(faq =>
      faq.question.toLowerCase().includes(query.toLowerCase()) ||
      faq.answer.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes(faq.category.toLowerCase())
    );

    return matches.length > 0 ? matches[0] : null;
    } catch (error) {
      log.error('검색 중 오류:', error);
      // Fallback: 키워드 매칭
      const activeFaqs = faqs.filter(faq => faq.isActive);
      const matches = activeFaqs.filter(faq =>
        faq.question.toLowerCase().includes(query.toLowerCase()) ||
        faq.answer.toLowerCase().includes(query.toLowerCase())
      );
      return matches.length > 0 ? matches[0] : null;
    }
  };

  // Gemini를 활용한 복합 질문 분리
  const splitCompoundQuestion = async (text: string): Promise<string[]> => {
    try {
      const result = await WebGeminiService.getInstance().generateResponse(
        text,
        [{ content: '다음 텍스트에서 개별 질문들을 분리해주세요. 각 질문을 줄바꿈으로 구분하여 반환해주세요. 질문이 아닌 부분은 제외하세요. 원문의 의미를 변경하지 마세요.', source: 'system', similarity: 1 }],
        []
      );

      if (result.text) {
        const questions = result.text
          .split('\n')
          .map(q => q.replace(/^\d+[\.\)]\s*/, '').trim())
          .filter(q => q.length > 3);
        if (questions.length >= 2) return questions;
      }
    } catch (error) {
      log.error('복합 질문 분리 실패:', error);
    }
    return [text];
  };

  // 단일 질문에 대한 검색 및 응답 생성
  const processQuestion = async (query: string): Promise<{
    responseText: string;
    matchedFaq: FAQ | null;
    confidence: number | undefined;
    searchResults: any[];
    relatedImages: Message['relatedImages'];
    relatedGraphs: Message['relatedGraphs'];
    relatedChunks: Message['relatedChunks'];
    relatedDocuments: Message['relatedDocuments'];
  }> => {
    const searchResults = await vectorSearchService.search(query, {
      limit: 5,
      minSimilarity: FAQ_MIN_SIMILARITY,
      includeFAQs: true,
      includeDocuments: false,
      includeChunks: true,
      includeImages: false,
      includeGraphs: false
    });

    let matchedFaq: FAQ | null = null;
    const relatedImages: Message['relatedImages'] = [];
    const relatedGraphs: Message['relatedGraphs'] = [];
    const relatedChunks: Message['relatedChunks'] = [];
    const relatedDocuments: Message['relatedDocuments'] = [];
    const documentSet = new Set<number>();

    const hasMeaningfulResult = searchResults.length > 0 && searchResults[0].similarity >= FAQ_MIN_SIMILARITY;
    if (hasMeaningfulResult) {
      if (searchResults[0].type === 'faq') {
        matchedFaq = searchResults[0].item as FAQ;
      }

      searchResults.forEach(result => {
        if (result.type === 'chunk') {
          const chunk = result.item as import('../types').PDFChunk;
          relatedChunks.push({
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            sourceDocument: result.sourceDocument ? {
              id: result.sourceDocument.id,
              name: result.sourceDocument.name,
              filePath: result.sourceDocument.filePath
            } : undefined
          });
          if (result.sourceDocument && !documentSet.has(result.sourceDocument.id)) {
            documentSet.add(result.sourceDocument.id);
            relatedDocuments.push({
              id: result.sourceDocument.id,
              name: result.sourceDocument.name,
              filePath: result.sourceDocument.filePath
            });
          }
        }
      });

      const bestResult = searchResults[0];
      const bestSimilarity = bestResult.similarity;
      let responseText: string;

      if (bestResult.type === 'faq') {
        const faq = bestResult.item as FAQ;
        if (bestSimilarity >= FAQ_HIGH_CONFIDENCE) {
          responseText = faq.answer;
        } else if (bestSimilarity >= FAQ_MEDIUM_CONFIDENCE) {
          responseText = `관련 FAQ를 찾았습니다.\n\n${faq.answer}`;
        } else {
          responseText = '';
        }
      } else if (bestResult.type === 'chunk') {
        const chunk = bestResult.item as import('../types').PDFChunk;
        responseText = chunk.content || '관련 내용을 찾았지만 표시할 수 없습니다.';
      } else {
        responseText = '관련 정보를 찾았지만 답변을 제공할 수 없습니다.';
      }

      if (responseText) {
        return {
          responseText,
          matchedFaq,
          confidence: bestSimilarity,
          searchResults,
          relatedImages: relatedImages.length > 0 ? relatedImages : undefined,
          relatedGraphs: relatedGraphs.length > 0 ? relatedGraphs : undefined,
          relatedChunks: relatedChunks.length > 0 ? relatedChunks : undefined,
          relatedDocuments: relatedDocuments.length > 0 ? relatedDocuments : undefined
        };
      }
    }

    // Fallback
    return {
      responseText: '',
      matchedFaq: null,
      confidence: 0,
      searchResults: [],
      relatedImages: undefined,
      relatedGraphs: undefined,
      relatedChunks: undefined,
      relatedDocuments: undefined
    };
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const trimmedInput = inputText.trim();

    // 복합 질문 감지
    const isCompound = detectCompoundQuestion(trimmedInput);

    const userMessage: Message = {
      id: Date.now(),
      text: trimmedInput,
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    void logMessage({
      sender: 'user',
      message: userMessage.text,
      timestamp: userMessage.timestamp,
      messageType: 'text'
    });

    // 복합 질문인 경우: Gemini로 분리 후 개별 처리
    if (isCompound) {
      try {
        log.debug('🔀 복합 질문 감지, 분리 시도:', trimmedInput);
        const questions = await splitCompoundQuestion(trimmedInput);

        if (questions.length >= 2) {
          log.debug(`✅ ${questions.length}개 질문으로 분리됨`);

          const answers: string[] = [];
          let anyResolved = false;
          let lastCategory: string | undefined;
          let lastFaqId: number | undefined;
          let overallConfidence: number | undefined;

          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const result = await processQuestion(q);

            if (result.searchResults.length > 0 && result.responseText) {
              answers.push(`[질문 ${i + 1}] ${q}\n${replaceCustomerServicePlaceholders(removeMarkdown(result.responseText), customerServiceInfo)}`);
              if (result.matchedFaq) {
                anyResolved = true;
                lastCategory = result.matchedFaq.category;
                lastFaqId = result.matchedFaq.id;
              }
              if (result.confidence !== undefined) {
                overallConfidence = overallConfidence !== undefined
                  ? Math.max(overallConfidence, result.confidence)
                  : result.confidence;
              }
            } else {
              answers.push(`[질문 ${i + 1}] ${q}\n해당 질문에 대한 답변을 찾을 수 없습니다.`);
            }
          }

          const combinedText = answers.join('\n\n');
          const botResponse: Message = {
            id: Date.now() + 1,
            text: combinedText,
            isUser: false,
            timestamp: new Date()
          };

          setMessages(prev => [...prev, botResponse]);
          setIsTyping(false);

          const responseTime = botResponse.timestamp.getTime() - userMessage.timestamp.getTime();
          void logMessage({
            sender: 'bot',
            message: botResponse.text,
            timestamp: botResponse.timestamp,
            messageType: 'text',
            responseTime,
            confidence: overallConfidence,
            sourceFaq: lastFaqId
          });

          if (anyResolved) {
            setSessionCategory(prev => prev || lastCategory);
            setIsSessionResolved(true);
            updateSession({ category: lastCategory, isResolved: true });
          } else {
            setIsSessionResolved(false);
            updateSession({ isResolved: false });
          }
          return;
        }
        // 분리 실패 시 단일 질문으로 계속 진행
      } catch (error) {
        log.error('복합 질문 처리 실패, 단일 질문으로 처리:', error);
      }
    }

    // 단일 질문 처리 (기존 로직)
    try {
      log.debug('🔍 벡터 검색 시작:', trimmedInput);

      // 1. 벡터 검색 수행 (FAQ 우선, 빠른 응답을 위해 최적화)
      // FAQ가 높은 점수면 바로 사용, 아니면 청크와 문서도 검색
      const searchResults = await vectorSearchService.search(trimmedInput, {
        limit: 5,
        minSimilarity: FAQ_MIN_SIMILARITY,
        includeFAQs: true,
        includeDocuments: false, // 성능 최적화: 필요시에만 활성화
        includeChunks: true, // Gemini RAG를 위해 청크 포함
        includeImages: false, // 성능 최적화: 필요시에만 활성화
        includeGraphs: false // 성능 최적화: 필요시에만 활성화
      });

      log.debug(`✅ 검색 결과 ${searchResults.length}개 발견`);

      // 결과 타입별 개수 확인
      const chunkCount = searchResults.filter(r => r.type === 'chunk').length;
      if (chunkCount > 0) {
        log.debug(`📝 관련 청크 ${chunkCount}개`);
      }

      let botResponse: Message;
      let matchedFaq: FAQ | null = null;

      const hasMeaningfulResult = searchResults.length > 0 && searchResults[0].similarity >= FAQ_MIN_SIMILARITY;
      if (hasMeaningfulResult) {
        // 가장 유사한 결과가 FAQ인 경우
        if (searchResults[0].type === 'faq') {
          matchedFaq = searchResults[0].item as FAQ;
        }

        // 2. 검색 결과를 컨텍스트로 변환 및 관련 이미지/그래프/청크/문서 추출
        const context: string[] = [];
        const relatedImages: Message['relatedImages'] = [];
        const relatedGraphs: Message['relatedGraphs'] = [];
        const relatedChunks: Message['relatedChunks'] = [];
        const relatedDocuments: Message['relatedDocuments'] = [];
        const documentSet = new Set<number>();

        searchResults.forEach(result => {
          if (result.type === 'faq') {
            const faq = result.item as FAQ;
            context.push(`[FAQ] Q: ${faq.question}\nA: ${faq.answer}`);
          } else if (result.type === 'chunk') {
            const chunk = result.item as import('../types').PDFChunk;
            context.push(`[문서 내용] ${chunk.content}`);
            // 청크 정보 추가
            relatedChunks.push({
              content: chunk.content,
              pageNumber: chunk.pageNumber,
              sourceDocument: result.sourceDocument ? {
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              } : undefined
            });
            // 청크의 출처 문서 추가
            if (result.sourceDocument && !documentSet.has(result.sourceDocument.id)) {
              documentSet.add(result.sourceDocument.id);
              relatedDocuments.push({
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              });
            }
          } else if (result.type === 'document') {
            const doc = result.item as import('../types').PDFDocument;
            context.push(`[문서] ${doc.name}: ${doc.metadata?.textContent || ''}`);
            if (!documentSet.has(doc.id)) {
              documentSet.add(doc.id);
              relatedDocuments.push({
                id: doc.id,
                name: doc.name,
                filePath: doc.filePath
              });
            }
          } else if (result.type === 'image' && result.sourceDocument) {
            const image = result.item as import('../types').DocumentImage;
            context.push(`[이미지] ${image.description || image.fileName}`);
            relatedImages.push({
              url: image.url,
              description: image.description,
              sourceDocument: {
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              }
            });
            if (!documentSet.has(result.sourceDocument.id)) {
              documentSet.add(result.sourceDocument.id);
              relatedDocuments.push({
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              });
            }
          } else if (result.type === 'graph' && result.sourceDocument) {
            const graph = result.item as import('../types').DocumentGraph;
            context.push(`[그래프] ${graph.title || graph.description || graph.fileName}`);
            relatedGraphs.push({
              url: graph.url,
              title: graph.title,
              description: graph.description,
              sourceDocument: {
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              }
            });
            if (!documentSet.has(result.sourceDocument.id)) {
              documentSet.add(result.sourceDocument.id);
              relatedDocuments.push({
                id: result.sourceDocument.id,
                name: result.sourceDocument.name,
                filePath: result.sourceDocument.filePath
              });
            }
          }
        });

        log.debug(`📚 컨텍스트 준비 완료: ${context.length}개 항목`);

        // 3. 유사도 기반 FAQ 직접 반환 (LLM 없이)
        let responseText: string;
        const bestResult = searchResults[0];
        const bestSimilarity = bestResult.similarity;

        if (bestResult.type === 'faq') {
          const faq = bestResult.item as FAQ;
          if (bestSimilarity >= FAQ_HIGH_CONFIDENCE) {
            responseText = faq.answer;
          } else if (bestSimilarity >= FAQ_MEDIUM_CONFIDENCE) {
            responseText = `관련 FAQ를 찾았습니다.\n\n${faq.answer}`;
          } else {
            // 임계값 미만이면 Fallback 처리로 넘어감
            responseText = '';
          }
        } else if (bestResult.type === 'chunk') {
          const chunk = bestResult.item as import('../types').PDFChunk;
          responseText = chunk.content || '관련 내용을 찾았지만 표시할 수 없습니다.';
        } else {
          responseText = '관련 정보를 찾았지만 답변을 제공할 수 없습니다.';
        }

        if (responseText) {
          log.debug(`✅ FAQ 직접 반환 (유사도: ${bestSimilarity.toFixed(3)})`);

          botResponse = {
            id: Date.now() + 1,
            text: replaceCustomerServicePlaceholders(removeMarkdown(responseText), customerServiceInfo),
            isUser: false,
            timestamp: new Date(),
            faq: matchedFaq || undefined,
            relatedImages: relatedImages.length > 0 ? relatedImages : undefined,
            relatedGraphs: relatedGraphs.length > 0 ? relatedGraphs : undefined,
            relatedChunks: relatedChunks.length > 0 ? relatedChunks : undefined,
            relatedDocuments: relatedDocuments.length > 0 ? relatedDocuments : undefined
          };
        } else {
          // 유사도가 임계값 미만이어서 Fallback 처리
          log.debug(`⚠️  유사도 부족 (${bestSimilarity.toFixed(3)}) - Fallback 처리`);
          matchedFaq = null;
          const fallbackText = buildFallbackMessage(customerServiceInfo);
          botResponse = {
            id: Date.now() + 1,
            text: fallbackText,
            isUser: false,
            timestamp: new Date()
          };
        }
      } else {
        // 검색 결과가 없을 때 - 관리자가 설정한 Fallback 메시지 사용
        log.debug('⚠️  검색 결과 없음 - Fallback 고객센터 안내');

        const fallbackText = buildFallbackMessage(customerServiceInfo);

        botResponse = {
          id: Date.now() + 1,
          text: fallbackText,
          isUser: false,
          timestamp: new Date()
        };
      }

      setMessages(prev => [...prev, botResponse]);
      setIsTyping(false);

      const responseTime = botResponse.timestamp.getTime() - userMessage.timestamp.getTime();
      const isFallback = !hasMeaningfulResult || !matchedFaq;
      const confidence = isFallback ? 0 : (matchedFaq && searchResults.length > 0 ? searchResults[0].similarity : undefined);

      void logMessage({
        sender: 'bot',
        message: botResponse.text,
        timestamp: botResponse.timestamp,
        messageType: 'text',
        responseTime,
        confidence,
        sourceFaq: matchedFaq?.id
      });

      if (matchedFaq) {
        setSessionCategory(prev => prev || matchedFaq.category);
        setIsSessionResolved(true);
        updateSession({
          category: matchedFaq.category,
          isResolved: true
        });
      } else {
        setIsSessionResolved(false);
        updateSession({ isResolved: false });
      }
    } catch (error) {
      log.error('응답 생성 중 오류:', error);
      const errorResponse: Message = {
        id: Date.now() + 1,
        text: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        isUser: false,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorResponse]);
      setIsTyping(false);

      void logMessage({
        sender: 'bot',
        message: errorResponse.text,
        timestamp: errorResponse.timestamp,
        messageType: 'text'
      });

      updateSession({ isResolved: false });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // quickQuestions는 featuredFAQs에서 가져옴 (최대 4개)

  const handleQuickQuestion = (question: string) => {
    setInputText(question);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ml-3">
              <h1 className="text-lg font-semibold text-black">금융 FAQ 챗봇</h1>
              <p className="text-sm text-gray-500">24시간 언제든지 질문하세요</p>
            </div>
          </div>
          <button
            onClick={() => {
              finalizeSession().finally(() => {
                onGoToAdmin?.();
              });
            }}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors duration-200"
          >
            관리자 화면으로 돌아가기
          </button>
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 max-w-4xl mx-auto w-full p-4 overflow-hidden">
        <div className="bg-white rounded-2xl shadow-lg h-full flex flex-col max-h-[calc(100vh-120px)]">
          {/* Messages */}
          <div className="flex-1 p-6 overflow-y-auto space-y-4 min-h-0">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-xs lg:max-w-md ${message.isUser ? 'order-2' : 'order-1'}`}>
                  {!message.isUser && (
                    <div className="flex items-center mb-2">
                      <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <span className="ml-2 text-sm font-medium text-gray-600">챗봇</span>
                    </div>
                  )}
                  <div
                    className={`px-4 py-3 rounded-2xl ${
                      message.isUser
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white'
                        : 'bg-gray-100 text-black'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    {message.faq && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {message.faq.category}
                        </span>
                        {(() => {
                          const safeImageUrl = sanitizeUrl(message.faq.imageUrl);
                          return safeImageUrl && (
                            <div className="mt-3">
                              <img
                                src={safeImageUrl}
                                alt="FAQ 이미지"
                                className="max-w-full h-auto rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => { const url = sanitizeUrl(message.faq?.imageUrl); if (url) window.open(url, '_blank'); }}
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                }}
                              />
                            </div>
                          );
                        })()}
                        {(() => {
                          const safeLinkUrl = sanitizeUrl(message.faq.linkUrl);
                          return safeLinkUrl && (
                            <a
                              href={safeLinkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
                            >
                              자세히 보기 →
                            </a>
                          );
                        })()}
                        {message.faq.attachmentUrl && (
                          <a
                            href={message.faq.attachmentUrl}
                            download={message.faq.attachmentName}
                            className="block mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
                          >
                            📎 {message.faq.attachmentName} 다운로드
                          </a>
                        )}
                        {message.faq.sourceDocument && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-xs font-semibold text-gray-700 mb-2">📄 출처 문서</p>
                            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                              <div className="flex items-center space-x-2 flex-1 min-w-0">
                                <svg className="w-5 h-5 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {message.faq.sourceDocument.filePath ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const documents = await dbService.getAllDocuments();
                                        const doc = documents.find(d => d.name === message.faq?.sourceDocument?.name);
                                        if (doc) {
                                          showToast('웹 버전에서는 문서 다운로드가 지원되지 않습니다.', 'info');
                                        } else {
                                          showToast('문서를 찾을 수 없습니다.', 'error');
                                        }
                                      } catch (error) {
                                        log.error('문서 다운로드 실패:', error);
                                        showToast('문서 다운로드에 실패했습니다.', 'error');
                                      }
                                    }}
                                    className="text-sm text-blue-600 hover:text-blue-700 underline truncate cursor-pointer"
                                    title="클릭하여 다운로드"
                                  >
                                    {message.faq.sourceDocument.name}
                                  </button>
                                ) : (
                                  <span className="text-sm text-gray-700 truncate">{message.faq.sourceDocument.name}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Related Images */}
                    {message.relatedImages && message.relatedImages.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs font-semibold text-gray-700 mb-2">📸 관련 이미지</p>
                        <div className="grid grid-cols-2 gap-2">
                          {message.relatedImages.slice(0, 4).map((image, idx) => (
                            <div key={idx} className="relative group">
                              <img
                                src={image.url}
                                alt={image.description || '이미지'}
                                className="w-full h-24 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => window.open(image.url, '_blank')}
                              />
                              {image.description && (
                                <p className="text-xs text-gray-600 mt-1 line-clamp-2">{image.description}</p>
                              )}
                              {image.sourceDocument && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  출처: {image.sourceDocument.name}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Graphs */}
                    {message.relatedGraphs && message.relatedGraphs.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs font-semibold text-gray-700 mb-2">📊 관련 그래프</p>
                        <div className="space-y-2">
                          {message.relatedGraphs.slice(0, 3).map((graph, idx) => (
                            <div key={idx} className="bg-gray-50 rounded-lg p-2">
                              <img
                                src={graph.url}
                                alt={graph.title || '그래프'}
                                className="w-full h-32 object-contain rounded cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => window.open(graph.url, '_blank')}
                              />
                              {graph.title && (
                                <p className="text-sm font-medium text-gray-700 mt-2">{graph.title}</p>
                              )}
                              {graph.description && (
                                <p className="text-xs text-gray-600 mt-1">{graph.description}</p>
                              )}
                              {graph.sourceDocument && (
                                <p className="text-xs text-gray-500 mt-1">
                                  출처: {graph.sourceDocument.name}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Chunks */}
                    {message.relatedChunks && message.relatedChunks.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs font-semibold text-gray-700 mb-2">📄 관련 문서 내용</p>
                        <div className="space-y-2">
                          {message.relatedChunks.slice(0, 3).map((chunk, idx) => (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3">
                              <p className="text-sm text-gray-700 line-clamp-3">{chunk.content}</p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-gray-500">페이지 {chunk.pageNumber}</span>
                                {chunk.sourceDocument && (
                                  <span className="text-xs text-gray-500">출처: {chunk.sourceDocument.name}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Documents */}
                    {message.relatedDocuments && message.relatedDocuments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs font-semibold text-gray-700 mb-2">📄 관련 문서</p>
                        <div className="space-y-2">
                          {message.relatedDocuments.map((doc, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                              <div className="flex items-center space-x-2 flex-1 min-w-0">
                                <svg className="w-5 h-5 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {doc.filePath ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        showToast('웹 버전에서는 문서 다운로드가 지원되지 않습니다.', 'info');
                                      } catch (error) {
                                        log.error('문서 다운로드 실패:', error);
                                        showToast('문서 다운로드 중 오류가 발생했습니다.', 'error');
                                      }
                                    }}
                                    className="text-sm text-blue-600 hover:text-blue-700 underline truncate cursor-pointer"
                                    title="클릭하여 다운로드"
                                  >
                                    {doc.name}
                                  </button>
                                ) : (
                                  <span className="text-sm text-gray-700 truncate">{doc.name}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 px-2">
                    {message.timestamp.toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="max-w-xs lg:max-w-md">
                  <div className="flex items-center mb-2">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <span className="ml-2 text-sm font-medium text-gray-600">챗봇</span>
                  </div>
                  <div className="bg-gray-100 px-4 py-3 rounded-2xl">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Questions */}
          {messages.length === 1 && (
            <div className="px-6 py-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-600 mb-3">자주 묻는 질문:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {featuredFAQs.length > 0 ? (
                  featuredFAQs.slice(0, 4).map((faq) => (
                    <button
                      key={faq.id}
                      onClick={() => handleQuickQuestion(faq.question)}
                      className="text-left p-3 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors duration-200"
                    >
                      {faq.question}
                    </button>
                  ))
                ) : (
                  <p className="col-span-2 text-sm text-gray-400 text-center py-4">
                    FAQ 관리에서 자주 묻는 질문을 지정해주세요.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-6 border-t border-gray-100">
            <div className="flex items-center space-x-3">
              <div className="flex-1 relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="한 번에 하나의 질문을 입력해 주세요"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  rows={1}
                  style={{ minHeight: '48px', maxHeight: '120px' }}
                  disabled={isTyping}
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isTyping}
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-3 rounded-xl hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <div className="mt-6 bg-gray-50 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">이번 상담은 도움이 되었나요?</p>
                  <p className="text-xs text-gray-500">평가를 남기면 관리자 페이지에 반영됩니다.</p>
                </div>
                <div className="flex items-center space-x-2">
                  {[1, 2, 3, 4, 5].map(score => (
                    <button
                      key={score}
                      onClick={() => {
                        setSatisfaction(score);
                        void updateSession({ satisfaction: score });
                      }}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                        satisfaction === score
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-blue-50 hover:text-blue-600'
                      }`}
                    >
                      {score}점
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setSatisfaction(null);
                      void updateSession({ satisfaction: undefined });
                    }}
                    className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700"
                  >
                    초기화
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserChatbot;
