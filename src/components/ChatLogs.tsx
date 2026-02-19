import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getSupabaseDatabaseService } from '../services/supabase';
import { autoEmbeddingService } from '../services/autoEmbeddingService';
import { ChatSession, ChatLogMessage, FAQ } from '../types';
import { useToast } from './Toast';
import { exportChatLogsToExcel } from '../services/excelExportService';
import { createLogger } from '../services/logger';


const log = createLogger('ChatLogs');
interface ChatConversation {
  id: number;
  sessionId: string;
  user: string;
  userEmail: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  duration: string;
  status: 'completed' | 'ongoing' | 'abandoned';
  satisfaction?: number; // 1-5 rating
  category: string;
  isResolved: boolean;
  tags: string[];
  messages: ChatMessage[];
}

interface ChatMessage {
  id: number;
  timestamp: string;
  sender: 'user' | 'bot';
  message: string;
  messageType?: 'text' | 'file' | 'image';
  responseTime?: number; // in milliseconds
  confidence?: number; // AI confidence score
  sourceFaq?: number; // FAQ ID that was used for response
}

const REAL_DATA_TAG = '실제 데이터';

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

const formatDuration = (startTime: string, endTime?: string): string => {
  if (!startTime || !endTime) {
    return '';
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }

  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  return `${minutes}분 ${seconds}초`;
};

const mapSessionToConversation = (
  session: ChatSession,
  messages: ChatLogMessage[]
): ChatConversation => {
  const duration = session.duration || formatDuration(session.startTime, session.endTime);
  const tags = Array.isArray(session.tags) && session.tags.length > 0 ? session.tags : [REAL_DATA_TAG];

  return {
    id: session.id,
    sessionId: session.sessionId,
    user: session.user || '익명 사용자',
    userEmail: session.userEmail || '',
    startTime: session.startTime,
    endTime: session.endTime || '',
    messageCount: session.messageCount || messages.length,
    duration: duration || '',
    status: session.status,
    satisfaction: session.satisfaction,
    category: session.category || '기타',
    isResolved: session.isResolved,
    tags,
    messages: messages.map(message => ({
      id: message.id,
      timestamp: message.timestamp,
      sender: message.sender,
      message: message.message,
      messageType: message.messageType,
      responseTime: message.responseTime,
      confidence: message.confidence,
      sourceFaq: message.sourceFaq
    }))
  };
};

const parseDurationToMinutes = (duration: string): number | null => {
  if (!duration) {
    return null;
  }

  const match = duration.match(/(?:(\d+)분)?\s*(?:(\d+)초)?/);
  if (!match) {
    return null;
  }

  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = match[2] ? parseInt(match[2], 10) : 0;

  if ((!match[1] && !match[2]) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null;
  }

  return minutes + seconds / 60;
};

// Mock data removed for production - empty state will be shown when no data available

const FAQ_CATEGORIES = ['조사 의뢰 및 견적 문의', '주식 및 IR 관련 문의', '기타 문의상담', '계좌', '대출', '송금', '온라인뱅킹', '일반'];

const ChatLogs: React.FC = () => {
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);
  const { showToast } = useToast();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'ongoing' | 'abandoned'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // FAQ 등록 관련 상태
  const [showFaqForm, setShowFaqForm] = useState(false);
  const [faqFormData, setFaqFormData] = useState({ question: '', answer: '', category: '일반' });
  const [isSavingFaq, setIsSavingFaq] = useState(false);
  const [registeredFaqSessionIds, setRegisteredFaqSessionIds] = useState<Set<string>>(new Set());

  const itemsPerPage = 10;

  // Filter conversations based on search and filters
  const filteredConversations = useMemo(() => {
    return conversations.filter(conv => {
      const matchesSearch = conv.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           conv.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           conv.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           conv.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === 'all' || conv.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || conv.category === categoryFilter;

      let matchesDate = true;
      if (dateFilter !== 'all') {
        const convDate = new Date(conv.startTime);
        const today = new Date();

        switch (dateFilter) {
          case 'today':
            matchesDate = convDate.toDateString() === today.toDateString();
            break;
          case 'week':
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            matchesDate = convDate >= weekAgo;
            break;
          case 'month':
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            matchesDate = convDate >= monthAgo;
            break;
        }
      }

      const matchesUnresolved = !unresolvedOnly || !conv.isResolved;

      return matchesSearch && matchesStatus && matchesCategory && matchesDate && matchesUnresolved;
    });
  }, [conversations, searchTerm, statusFilter, categoryFilter, dateFilter, unresolvedOnly]);

  // Pagination
  const totalPages = Math.ceil(filteredConversations.length / itemsPerPage);
  const paginatedConversations = filteredConversations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Get unique categories for filter
  const categories = [...new Set(
    conversations
      .map(conv => conv.category)
      .filter((category): category is string => Boolean(category))
  )];

  // Statistics
  const stats = useMemo(() => {
    const total = conversations.length;
    const completed = conversations.filter(c => c.status === 'completed').length;
    const satisfactionConversations = conversations.filter(
      (c): c is ChatConversation & { satisfaction: number } => typeof c.satisfaction === 'number'
    );
    const avgSatisfactionValue = satisfactionConversations.length > 0
      ? satisfactionConversations.reduce((sum, c) => sum + (c.satisfaction ?? 0), 0) / satisfactionConversations.length
      : 0;

    const durationValues = conversations
      .map(c => parseDurationToMinutes(c.duration))
      .filter((value): value is number => value !== null);

    const avgDurationMinutes = durationValues.length > 0
      ? durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
      : 0;

    const avgDurationText = durationValues.length > 0
      ? `${Math.floor(avgDurationMinutes)}분 ${Math.floor((avgDurationMinutes % 1) * 60)}초`
      : '0분 0초';

    const unresolved = conversations.filter(c => !c.isResolved).length;

    return {
      total,
      completed,
      unresolved,
      avgSatisfaction: avgSatisfactionValue.toFixed(1),
      avgDuration: avgDurationText
    };
  }, [conversations]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'ongoing': return 'bg-blue-100 text-blue-800';
      case 'abandoned': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return '완료';
      case 'ongoing': return '진행중';
      case 'abandoned': return '중단됨';
      default: return '알 수 없음';
    }
  };

  const getSatisfactionStars = (rating?: number) => {
    if (!rating) return '평가없음';
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  };

  const handleViewDetails = (conversation: ChatConversation) => {
    setSelectedConversation(conversation);
    setShowDetails(true);
  };

  const reloadConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const sessions = await dbService.getAllChatSessions();

      const dynamicConversations = await Promise.all(
        sessions.map(async (session: ChatSession) => {
          const messages: ChatLogMessage[] = await dbService.getChatMessagesBySessionId(session.sessionId);
          return mapSessionToConversation(session, messages);
        })
      );

      if (dynamicConversations.length === 0) {
        setConversations([]);

        setLoadError('최근 채팅 데이터가 없습니다.');
      } else {
        setConversations(dynamicConversations.map(conv => ({
          ...conv,
          tags: conv.tags.includes(REAL_DATA_TAG) ? conv.tags : [...conv.tags, REAL_DATA_TAG]
        })));

      }

      setLastUpdated(new Date().toISOString());
      setCurrentPage(1);
    } catch (error) {
      log.error('채팅 로그 로드 실패:', error);
      setConversations([]);

      setLoadError('데이터베이스에서 채팅 로그를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [dbService]);

  useEffect(() => {
    reloadConversations();
  }, [reloadConversations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">채팅 로그 관리</h1>
            <p className="text-gray-600 mt-1">전체 채팅 대화 기록 및 분석</p>
            {loadError && (
              <p className="text-sm text-amber-600 mt-2">{loadError}</p>
            )}
          </div>
          <div className="flex flex-col items-end space-y-2">
            <div>
              <p className="text-sm text-gray-500">마지막 동기화</p>
              <p className="text-sm font-medium text-black">
                {lastUpdated ? new Date(lastUpdated).toLocaleString('ko-KR') : '데이터 없음'}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const sessionsToExport = filteredConversations.map(conv => ({
                    id: conv.id,
                    sessionId: conv.sessionId,
                    user: conv.user,
                    userEmail: conv.userEmail,
                    startTime: conv.startTime,
                    endTime: conv.endTime || undefined,
                    messageCount: conv.messageCount,
                    status: conv.status,
                    satisfaction: conv.satisfaction,
                    category: conv.category,
                    isResolved: conv.isResolved,
                    tags: conv.tags,
                  } as ChatSession));
                  exportChatLogsToExcel(sessionsToExport);
                }}
                disabled={filteredConversations.length === 0}
                className="px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                엑셀 다운로드
              </button>
              <button
                onClick={reloadConversations}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '동기화 중...' : '데이터 새로고침'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div>
            <p className="text-sm font-medium text-gray-600">총 대화 수</p>
            <p className="text-2xl font-bold text-black mt-2">{stats.total}</p>
            <div className="flex items-center mt-2">
              <span className="text-sm text-gray-500">완료: {stats.completed}건</span>
            </div>
          </div>
        </div>
        <div
          className={`card hover:shadow-md transition-shadow duration-200 cursor-pointer ${unresolvedOnly ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => {
            setUnresolvedOnly(prev => !prev);
            setCurrentPage(1);
          }}
        >
          <div>
            <p className="text-sm font-medium text-gray-600">미해결 질문</p>
            <p className="text-2xl font-bold text-red-600 mt-2">{stats.unresolved}</p>
            <div className="flex items-center mt-2">
              <span className={`text-sm ${unresolvedOnly ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                {unresolvedOnly ? '필터 적용 중' : '클릭하여 필터'}
              </span>
            </div>
          </div>
        </div>
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div>
            <p className="text-sm font-medium text-gray-600">평균 만족도</p>
            <p className="text-2xl font-bold text-black mt-2">{stats.avgSatisfaction}/5.0</p>
            <div className="flex items-center mt-2">
              <span className="text-sm text-yellow-600">{getSatisfactionStars(Math.round(parseFloat(stats.avgSatisfaction)))}</span>
            </div>
          </div>
        </div>
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div>
            <p className="text-sm font-medium text-gray-600">평균 대화 시간</p>
            <p className="text-2xl font-bold text-black mt-2">{stats.avgDuration}</p>
            <div className="flex items-center mt-2">
              <span className="text-sm text-gray-500">효율적인 응답</span>
            </div>
          </div>
        </div>
        <div className="card hover:shadow-md transition-shadow duration-200">
          <div>
            <p className="text-sm font-medium text-gray-600">해결률</p>
            <p className="text-2xl font-bold text-black mt-2">
              {conversations.length > 0
                ? `${Math.round((conversations.filter(c => c.isResolved).length / conversations.length) * 100)}%`
                : '0%'}
            </p>
            <div className="flex items-center mt-2">
              <span className="text-sm text-green-600">높은 해결률</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">검색</label>
            <input
              type="text"
              placeholder="사용자명, 이메일, 카테고리 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">상태</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            >
              <option value="all">전체</option>
              <option value="completed">완료</option>
              <option value="ongoing">진행중</option>
              <option value="abandoned">중단됨</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">카테고리</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            >
              <option value="all">전체</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">기간</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            >
              <option value="all">전체</option>
              <option value="today">오늘</option>
              <option value="week">최근 7일</option>
              <option value="month">최근 30일</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">해결 상태</label>
            <button
              onClick={() => {
                setUnresolvedOnly(prev => !prev);
                setCurrentPage(1);
              }}
              className={`w-full px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
                unresolvedOnly
                  ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {unresolvedOnly ? '미해결만 보기 ON' : '미해결만 보기'}
            </button>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setCategoryFilter('all');
                setDateFilter('all');
                setUnresolvedOnly(false);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors duration-200"
            >
              필터 초기화
            </button>
          </div>
        </div>
      </div>

      {/* Chat Logs Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-black">
            채팅 대화 목록 ({filteredConversations.length}건)
          </h3>
        </div>

        {filteredConversations.length === 0 ? (
          <div className="text-center py-12 px-6">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-lg text-gray-500 mb-2">데이터가 없습니다</p>
            <p className="text-sm text-gray-400">채팅 대화가 시작되면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    사용자 정보
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    대화 정보
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    상태
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    만족도
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedConversations.map((conversation) => (
                <tr key={conversation.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-black">{conversation.user}</div>
                      <div className="text-sm text-gray-500">{conversation.userEmail}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-black">
                      <div className="font-medium">{conversation.category}</div>
                      <div className="text-gray-500">
                        {new Date(conversation.startTime).toLocaleString('ko-KR')}
                      </div>
                      <div className="text-xs text-gray-400">
                        {conversation.messageCount}개 메시지 • {conversation.duration || '진행중'}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {conversation.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(conversation.status)}`}>
                      {getStatusText(conversation.status)}
                    </span>
                    {conversation.isResolved ? (
                      <div className="text-xs text-green-600 mt-1">해결됨</div>
                    ) : (
                      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 mt-1">
                        미해결
                      </div>
                    )}
                    {registeredFaqSessionIds.has(conversation.sessionId) && (
                      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 mt-1">
                        FAQ 등록됨
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {conversation.satisfaction ? (
                      <div>
                        <div className="text-yellow-500">{getSatisfactionStars(conversation.satisfaction)}</div>
                        <div className="text-xs text-gray-500">{conversation.satisfaction}/5</div>
                      </div>
                    ) : (
                      <span className="text-gray-400">평가없음</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => handleViewDetails(conversation)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      상세보기
                    </button>
                  </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && filteredConversations.length > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {filteredConversations.length}건 중 {(currentPage - 1) * itemsPerPage + 1}-
              {Math.min(currentPage * itemsPerPage, filteredConversations.length)}건 표시
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                이전
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1 text-sm rounded-md ${
                    currentPage === page
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Conversation Details Modal */}
      {showDetails && selectedConversation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <h3 className="text-lg font-semibold text-black">
                  채팅 상세 내역 - {selectedConversation.user}
                </h3>
                {!selectedConversation.isResolved && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    미해결
                  </span>
                )}
                {registeredFaqSessionIds.has(selectedConversation.sessionId) && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                    FAQ 등록됨
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setShowDetails(false);
                  setShowFaqForm(false);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-8rem)]">
              {/* Conversation Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">세션 ID</p>
                    <p className="font-medium text-black">{selectedConversation.sessionId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">카테고리</p>
                    <p className="font-medium text-black">{selectedConversation.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">대화 시간</p>
                    <p className="font-medium text-black">
                      {new Date(selectedConversation.startTime).toLocaleString('ko-KR')} -
                      {selectedConversation.endTime ? new Date(selectedConversation.endTime).toLocaleString('ko-KR') : '진행중'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">소요 시간</p>
                    <p className="font-medium text-black">{selectedConversation.duration || '진행중'}</p>
                  </div>
                </div>
              </div>

              {/* FAQ 등록 버튼 */}
              {!registeredFaqSessionIds.has(selectedConversation.sessionId) && !showFaqForm && (
                <div className="mb-6">
                  <button
                    onClick={() => {
                      const userMessages = selectedConversation.messages
                        .filter(m => m.sender === 'user')
                        .map(m => removeMarkdown(m.message));
                      const firstUserMessage = userMessages.length > 0 ? userMessages[0] : '';
                      setFaqFormData({
                        question: firstUserMessage,
                        answer: '',
                        category: selectedConversation.category || '일반'
                      });
                      setShowFaqForm(true);
                    }}
                    className="w-full px-4 py-3 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors duration-200 flex items-center justify-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    이 대화를 FAQ로 등록
                  </button>
                </div>
              )}

              {/* FAQ 등록 완료 표시 */}
              {registeredFaqSessionIds.has(selectedConversation.sessionId) && !showFaqForm && (
                <div className="mb-6 px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-center text-sm text-purple-700">
                    <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    이 대화는 FAQ로 등록되었습니다.
                  </div>
                </div>
              )}

              {/* 인라인 FAQ 등록 폼 */}
              {showFaqForm && (
                <div className="mb-6 border border-purple-200 rounded-lg p-4 bg-purple-50">
                  <h4 className="text-md font-semibold text-purple-800 mb-4">FAQ 등록</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">질문</label>
                      <input
                        type="text"
                        value={faqFormData.question}
                        onChange={(e) => setFaqFormData(prev => ({ ...prev, question: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-black"
                        placeholder="FAQ 질문을 입력하세요"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">답변</label>
                      <textarea
                        rows={4}
                        value={faqFormData.answer}
                        onChange={(e) => setFaqFormData(prev => ({ ...prev, answer: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-black"
                        placeholder="FAQ 답변을 입력하세요"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                      <select
                        value={faqFormData.category}
                        onChange={(e) => setFaqFormData(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-black"
                      >
                        {FAQ_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowFaqForm(false)}
                        className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors duration-200"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={!faqFormData.question.trim() || !faqFormData.answer.trim() || isSavingFaq}
                        onClick={async () => {
                          if (!faqFormData.question.trim() || !faqFormData.answer.trim()) return;
                          try {
                            setIsSavingFaq(true);
                            const newFaq = await dbService.createFAQ({
                              question: faqFormData.question.trim(),
                              answer: faqFormData.answer.trim(),
                              category: faqFormData.category,
                              isActive: true,
                            });
                            // 백그라운드 임베딩 생성
                            autoEmbeddingService.generateAndSaveFAQEmbeddings(newFaq).catch(err => {
                              log.error('FAQ 임베딩 생성 실패 (백그라운드):', err);
                            });
                            setRegisteredFaqSessionIds(prev => new Set(prev).add(selectedConversation.sessionId));
                            setShowFaqForm(false);
                            showToast('FAQ가 성공적으로 등록되었습니다.', 'success');
                          } catch (error) {
                            log.error('FAQ 등록 실패:', error);
                            showToast('FAQ 등록에 실패했습니다.', 'error');
                          } finally {
                            setIsSavingFaq(false);
                          }
                        }}
                        className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingFaq ? '저장 중...' : 'FAQ 저장'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="space-y-4">
                <h4 className="text-md font-semibold text-black">대화 내용</h4>
                {selectedConversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-2 ${
                        message.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-black'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{removeMarkdown(message.message)}</p>
                      <div className="flex justify-between items-center mt-2 text-xs opacity-75">
                        <span>{new Date(message.timestamp).toLocaleTimeString('ko-KR')}</span>
                        {message.sender === 'bot' && message.responseTime && (
                          <span>응답시간: {message.responseTime}ms</span>
                        )}
                      </div>
                      {message.sender === 'bot' && message.confidence && (
                        <div className="text-xs opacity-75 mt-1">
                          신뢰도: {Math.round(message.confidence * 100)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatLogs;
