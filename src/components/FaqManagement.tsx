import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FAQ, ChatAnalytics, FallbackMessageConfig, CustomerServiceInfo } from '../types';
import Modal from './Modal';
import { getSupabaseDatabaseService } from '../services/supabase';
import { autoEmbeddingService } from '../services/autoEmbeddingService';
import { useToast } from './Toast';
import { createLogger } from '../services/logger';

const log = createLogger('FaqMgmt');
type FeaturedMode = 'manual' | 'auto';

// Fallback 메시지 기본값
const FALLBACK_CONFIG_KEY = 'fallback-message-config';
const CUSTOMER_SERVICE_KEY = 'customer-service-info';

const DEFAULT_FALLBACK_CONFIG: FallbackMessageConfig = {
  title: '죄송합니다. 해당 질문에 대한 답변을 찾을 수 없습니다.',
  body: '아래 방법으로 도움을 받으실 수 있습니다:',
  showPhone: true,
  showEmail: true,
  showFaqGuide: true,
  additionalMessage: '',
};

const DEFAULT_CUSTOMER_SERVICE: CustomerServiceInfo = {
  phone: '1234-5678',
  email: 'support@embrain.com',
  operatingHours: '평일 09:00~18:00',
};

const loadFallbackConfig = (): FallbackMessageConfig => {
  try {
    const saved = localStorage.getItem(FALLBACK_CONFIG_KEY);
    if (saved) return { ...DEFAULT_FALLBACK_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_FALLBACK_CONFIG;
};

const loadCustomerServiceInfo = (): CustomerServiceInfo => {
  try {
    const saved = localStorage.getItem(CUSTOMER_SERVICE_KEY);
    if (saved) return { ...DEFAULT_CUSTOMER_SERVICE, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CUSTOMER_SERVICE;
};

/** Fallback 메시지를 조합하여 미리보기 텍스트를 생성 */
const buildFallbackPreview = (config: FallbackMessageConfig, cs: CustomerServiceInfo): string => {
  const lines: string[] = [config.title, ''];
  if (config.body) lines.push(config.body);
  if (config.showPhone) lines.push(`• 고객센터 전화 문의: ${cs.phone} (${cs.operatingHours})`);
  if (config.showEmail) lines.push(`• 이메일 문의: ${cs.email}`);
  if (config.showFaqGuide) lines.push(`• 위의 '자주 묻는 질문'을 확인해 보세요.`);
  if (config.additionalMessage) {
    lines.push('');
    lines.push(config.additionalMessage);
  }
  return lines.join('\n');
};

interface FeaturedSettings {
  mode: FeaturedMode;
  autoCount: number; // 자동 모드에서 노출할 FAQ 개수 (1-4)
  lastAutoUpdated?: string; // 마지막 자동 업데이트 시간
}

const FEATURED_SETTINGS_KEY = 'featured-faq-settings';

const loadFeaturedSettings = (): FeaturedSettings => {
  try {
    const saved = localStorage.getItem(FEATURED_SETTINGS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { mode: 'manual', autoCount: 4 };
};

const saveFeaturedSettings = (settings: FeaturedSettings) => {
  localStorage.setItem(FEATURED_SETTINGS_KEY, JSON.stringify(settings));
};

interface FaqManagementProps {
  faqs: FAQ[];
  setFaqs: React.Dispatch<React.SetStateAction<FAQ[]>>;
  onGoToChatbot?: () => void;
  onTestFaq?: (faq: FAQ) => void;
}

const FaqManagement: React.FC<FaqManagementProps> = ({ faqs, setFaqs, onGoToChatbot, onTestFaq }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQ | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFeaturedPanelOpen, setIsFeaturedPanelOpen] = useState(false);
  const [featuredSettings, setFeaturedSettings] = useState<FeaturedSettings>(loadFeaturedSettings);
  const [topQuestions, setTopQuestions] = useState<ChatAnalytics['topQuestions']>([]);
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);
  const [isFallbackPanelOpen, setIsFallbackPanelOpen] = useState(false);
  const [fallbackConfig, setFallbackConfig] = useState<FallbackMessageConfig>(loadFallbackConfig);
  const [csInfo, setCsInfo] = useState<CustomerServiceInfo>(loadCustomerServiceInfo);
  const itemsPerPage = 10;
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);
  const { showToast } = useToast();

  // Fallback 메시지 저장
  const handleSaveFallback = useCallback(() => {
    localStorage.setItem(FALLBACK_CONFIG_KEY, JSON.stringify(fallbackConfig));
    localStorage.setItem(CUSTOMER_SERVICE_KEY, JSON.stringify(csInfo));
    showToast('답변 불가 안내 메시지가 저장되었습니다.', 'success');
  }, [fallbackConfig, csInfo, showToast]);

  // Fallback 기본값 복원
  const handleResetFallback = useCallback(() => {
    setFallbackConfig(DEFAULT_FALLBACK_CONFIG);
    setCsInfo(DEFAULT_CUSTOMER_SERVICE);
    localStorage.setItem(FALLBACK_CONFIG_KEY, JSON.stringify(DEFAULT_FALLBACK_CONFIG));
    localStorage.setItem(CUSTOMER_SERVICE_KEY, JSON.stringify(DEFAULT_CUSTOMER_SERVICE));
    showToast('기본값으로 복원되었습니다.', 'info');
  }, [showToast]);

  // 현재 Featured FAQ 목록
  const featuredFaqs = useMemo(() => faqs.filter(f => f.isFeatured), [faqs]);

  // 주간 인기 질문 데이터 로드
  const loadTopQuestions = useCallback(async () => {
    try {
      const analytics = await dbService.getChatAnalytics('week');
      setTopQuestions(analytics.topQuestions || []);
    } catch (error) {
      log.error('인기 질문 로드 실패:', error);
    }
  }, [dbService]);

  // 자동 모드: 주간 인기 질문 기반으로 Featured FAQ 자동 설정
  const applyAutoFeatured = useCallback(async () => {
    setIsAutoProcessing(true);
    try {
      await loadTopQuestions();
      const analytics = await dbService.getChatAnalytics('week');
      const questions = analytics.topQuestions || [];

      // 기존 Featured 모두 해제
      for (const faq of featuredFaqs) {
        await dbService.setFAQFeatured(faq.id, false);
      }

      // 인기 질문과 매칭되는 FAQ를 Featured로 설정
      const activeFaqs = faqs.filter(f => f.isActive);
      let matchedCount = 0;

      for (const tq of questions) {
        if (matchedCount >= featuredSettings.autoCount) break;
        const query = tq.question.toLowerCase();
        const match = activeFaqs.find(faq =>
          !faq.isFeatured &&
          (faq.question.toLowerCase().includes(query) ||
           query.includes(faq.question.toLowerCase().substring(0, 10)))
        );
        if (match) {
          await dbService.setFAQFeatured(match.id, true);
          matchedCount++;
        }
      }

      // 매칭이 부족하면 가장 최근 활성 FAQ로 채우기
      if (matchedCount < featuredSettings.autoCount) {
        const remaining = activeFaqs
          .filter(f => !featuredFaqs.some(ff => ff.id === f.id))
          .slice(0, featuredSettings.autoCount - matchedCount);
        for (const faq of remaining) {
          if (matchedCount >= featuredSettings.autoCount) break;
          await dbService.setFAQFeatured(faq.id, true);
          matchedCount++;
        }
      }

      const newSettings: FeaturedSettings = {
        ...featuredSettings,
        mode: 'auto',
        lastAutoUpdated: new Date().toISOString()
      };
      setFeaturedSettings(newSettings);
      saveFeaturedSettings(newSettings);
      await reloadFAQs();
      showToast(`주간 인기 질문 기반으로 ${matchedCount}개 FAQ가 자동 설정되었습니다.`, 'success');
    } catch (error) {
      log.error('자동 Featured 설정 실패:', error);
      showToast('자동 설정에 실패했습니다.', 'error');
    } finally {
      setIsAutoProcessing(false);
    }
  }, [dbService, faqs, featuredFaqs, featuredSettings, loadTopQuestions, showToast]);

  // 패널 열 때 인기 질문 로드
  useEffect(() => {
    if (isFeaturedPanelOpen) {
      loadTopQuestions();
    }
  }, [isFeaturedPanelOpen, loadTopQuestions]);

  // Dynamic categories derived from FAQ data
  const categories = useMemo(() => {
    const uniqueCategories = new Set(faqs.map(faq => faq.category).filter(Boolean));
    return ['전체', ...Array.from(uniqueCategories).sort()];
  }, [faqs]);

  // Reload FAQs from database
  const reloadFAQs = async () => {
    try {
      const dbFAQs = await dbService.getAllFAQs();
      if (dbFAQs.length > 0) {
        setFaqs(dbFAQs);
      }
    } catch (error) {
      log.error('Failed to reload FAQs:', error);
    }
  };

  // Load FAQs on component mount
  useEffect(() => {
    reloadFAQs();
  }, []);

  // 필터 변경 시 페이지를 1로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory]);

  const filteredFaqs = useMemo(() => {
    return faqs.filter(faq => {
      const matchesSearch = faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === '전체' || faq.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [faqs, searchTerm, selectedCategory]);

  const totalPages = Math.ceil(filteredFaqs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedFaqs = filteredFaqs.slice(startIndex, startIndex + itemsPerPage);

  const handleAddFaq = () => {
    setEditingFaq(null);
    setIsModalOpen(true);
  };

  const handleEditFaq = (faq: FAQ) => {
    setEditingFaq(faq);
    setIsModalOpen(true);
  };

  const handleDeleteFaq = async (id: number) => {
    if (window.confirm('이 FAQ를 삭제하시겠습니까?')) {
      try {
        await dbService.deleteFAQ(id);
        setFaqs(prev => prev.filter(faq => faq.id !== id));
        showToast('FAQ가 성공적으로 삭제되었습니다.', 'success');
      } catch (error) {
        log.error('Failed to delete FAQ:', error);
        showToast('FAQ 삭제에 실패했습니다.', 'error');
      }
    }
  };

  const handleToggleActive = async (id: number) => {
    const faq = faqs.find(f => f.id === id);
    if (faq) {
      try {
        await dbService.updateFAQ(id, { isActive: !faq.isActive });
        setFaqs(prev => prev.map(f =>
          f.id === id ? { ...f, isActive: !f.isActive } : f
        ));
      } catch (error) {
        log.error('Failed to update FAQ:', error);
      }
    }
  };

  const handleToggleFeatured = async (id: number) => {
    const faq = faqs.find(f => f.id === id);
    if (faq) {
      try {
        const updatedFaq = await dbService.setFAQFeatured(id, !faq.isFeatured);
        if (updatedFaq) {
          setFaqs(prev => prev.map(f =>
            f.id === id ? updatedFaq : f
          ));

          if (updatedFaq.isFeatured) {
            showToast('자주 묻는 질문에 추가되었습니다.', 'success');
          } else {
            showToast('자주 묻는 질문에서 제거되었습니다.', 'info');
          }

          // Reload to reflect any changes from the 4-item limit
          await reloadFAQs();
        }
      } catch (error) {
        log.error('Failed to toggle featured FAQ:', error);
        showToast('자주 묻는 질문 설정에 실패했습니다.', 'error');
      }
    }
  };

  const handleSaveFaq = async (faqData: Omit<FAQ, 'id'>) => {
    try {
      let savedFaq: FAQ;

      if (editingFaq) {
        const updated = await dbService.updateFAQ(editingFaq.id, faqData);
        if (updated) {
          savedFaq = updated;
          setFaqs(prev => prev.map(faq =>
            faq.id === editingFaq.id ? updated : faq
          ));
        } else {
          throw new Error('FAQ 업데이트 실패');
        }
      } else {
        const newFaq = await dbService.createFAQ(faqData);
        savedFaq = newFaq;
        setFaqs(prev => [...prev, newFaq]);
      }

      // 백그라운드에서 임베딩 생성 (비동기, 블로킹 없음)
      autoEmbeddingService.generateAndSaveFAQEmbeddings(savedFaq).catch(error => {
        log.error('임베딩 생성 실패 (백그라운드):', error);
      });

      setIsModalOpen(false);
      showToast('FAQ가 성공적으로 저장되었습니다.', 'success');
    } catch (error) {
      log.error('Failed to save FAQ:', error);
      showToast('FAQ 저장에 실패했습니다.', 'error');
    }
  };

  const handleDownloadDocument = async (documentId: number, documentName: string) => {
    showToast('파일 다운로드는 데스크톱 앱에서만 지원됩니다.', 'warning');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">엠브레인Agent관리</h1>
            <p className="text-gray-600 mt-1">자주 묻는 질문을 관리하고 편집하세요</p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={reloadFAQs}
              className="flex items-center px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors duration-200"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </button>
            {onGoToChatbot && (
              <button
                onClick={onGoToChatbot}
                className="flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                채팅 테스트
              </button>
            )}
            <button
              onClick={handleAddFaq}
              className="btn-primary flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              새 FAQ 추가
            </button>
          </div>
        </div>
      </div>

      {/* Featured 엠브레인Agent관리 패널 토글 버튼 */}
      <div className="card">
        <button
          onClick={() => setIsFeaturedPanelOpen(!isFeaturedPanelOpen)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-black">자주 묻는 질문 관리</h2>
              <p className="text-sm text-gray-500">
                현재 {featuredFaqs.length}개 등록 · 모드: {featuredSettings.mode === 'auto' ? '자동 (주간 인기)' : '수동'}
              </p>
            </div>
          </div>
          <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isFeaturedPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 펼침 패널 */}
        {isFeaturedPanelOpen && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* 모드 선택 */}
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-700">설정 모드:</span>
              <div className="flex rounded-lg overflow-hidden border border-gray-300">
                <button
                  onClick={() => {
                    const newSettings = { ...featuredSettings, mode: 'manual' as FeaturedMode };
                    setFeaturedSettings(newSettings);
                    saveFeaturedSettings(newSettings);
                  }}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    featuredSettings.mode === 'manual'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  수동
                </button>
                <button
                  onClick={() => {
                    const newSettings = { ...featuredSettings, mode: 'auto' as FeaturedMode };
                    setFeaturedSettings(newSettings);
                    saveFeaturedSettings(newSettings);
                  }}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    featuredSettings.mode === 'auto'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  자동 (주간 인기)
                </button>
              </div>
            </div>

            {/* 자동 모드 설정 */}
            {featuredSettings.mode === 'auto' && (
              <div className="bg-yellow-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-yellow-800">자동 모드</p>
                    <p className="text-xs text-yellow-600 mt-1">주간 사용자 질문 빈도를 기준으로 자주 묻는 질문을 자동 선정합니다.</p>
                  </div>
                  <button
                    onClick={applyAutoFeatured}
                    disabled={isAutoProcessing}
                    className="flex items-center px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAutoProcessing ? (
                      <>
                        <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        적용 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        지금 적용
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center space-x-3">
                  <label className="text-sm text-yellow-700">노출 개수:</label>
                  <select
                    value={featuredSettings.autoCount}
                    onChange={(e) => {
                      const newSettings = { ...featuredSettings, autoCount: Number(e.target.value) };
                      setFeaturedSettings(newSettings);
                      saveFeaturedSettings(newSettings);
                    }}
                    className="px-3 py-1.5 text-sm border border-yellow-300 rounded-lg bg-white focus:ring-2 focus:ring-yellow-500"
                  >
                    {[1, 2, 3, 4].map(n => (
                      <option key={n} value={n}>{n}개</option>
                    ))}
                  </select>
                </div>
                {featuredSettings.lastAutoUpdated && (
                  <p className="text-xs text-yellow-500">
                    마지막 자동 업데이트: {new Date(featuredSettings.lastAutoUpdated).toLocaleString('ko-KR')}
                  </p>
                )}

                {/* 주간 인기 질문 미리보기 */}
                {topQuestions.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-yellow-700 mb-2">주간 인기 질문 TOP {Math.min(topQuestions.length, 5)}:</p>
                    <div className="space-y-1">
                      {topQuestions.slice(0, 5).map((tq, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs bg-white rounded px-3 py-1.5">
                          <span className="text-gray-700 truncate flex-1">{idx + 1}. {tq.question}</span>
                          <span className="text-yellow-600 font-medium ml-2 whitespace-nowrap">{tq.count}회</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 수동 모드 안내 */}
            {featuredSettings.mode === 'manual' && (
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-800">수동 모드</p>
                <p className="text-xs text-blue-600 mt-1">
                  아래 FAQ 목록에서 별(★) 아이콘을 클릭하여 자주 묻는 질문을 직접 선택하세요. (최대 4개)
                </p>
              </div>
            )}

            {/* 현재 등록된 Featured FAQ 목록 */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">현재 등록된 자주 묻는 질문 ({featuredFaqs.length}/4)</p>
              {featuredFaqs.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">등록된 자주 묻는 질문이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {featuredFaqs.map((faq, idx) => (
                    <div key={faq.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <span className="text-sm font-bold text-yellow-600">{idx + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{faq.question}</p>
                          <span className="text-xs text-gray-500">{faq.category}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleFeatured(faq.id)}
                        className="ml-2 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="자주 묻는 질문에서 제거"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 답변 불가 안내 메시지 (Fallback) 관리 패널 */}
      <div className="card">
        <button
          onClick={() => setIsFallbackPanelOpen(!isFallbackPanelOpen)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-black">답변 불가 안내 메시지 관리</h2>
              <p className="text-sm text-gray-500">등록된 FAQ가 없는 질문에 대한 안내 메시지를 설정합니다</p>
            </div>
          </div>
          <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isFallbackPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isFallbackPanelOpen && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-5">
            {/* 메시지 편집 영역 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 좌측: 편집 폼 */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">메시지 편집</h3>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">안내 제목</label>
                  <input
                    type="text"
                    value={fallbackConfig.title}
                    onChange={(e) => setFallbackConfig(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                    placeholder="예: 죄송합니다. 해당 질문에 대한 답변을 찾을 수 없습니다."
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">본문 안내 문구</label>
                  <input
                    type="text"
                    value={fallbackConfig.body}
                    onChange={(e) => setFallbackConfig(prev => ({ ...prev, body: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                    placeholder="예: 아래 방법으로 도움을 받으실 수 있습니다:"
                  />
                </div>

                {/* 고객센터 정보 */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-gray-700">고객센터 정보</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">전화번호</label>
                      <input
                        type="text"
                        value={csInfo.phone}
                        onChange={(e) => setCsInfo(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                        placeholder="1234-5678"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">운영 시간</label>
                      <input
                        type="text"
                        value={csInfo.operatingHours}
                        onChange={(e) => setCsInfo(prev => ({ ...prev, operatingHours: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                        placeholder="평일 09:00~18:00"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">이메일</label>
                    <input
                      type="text"
                      value={csInfo.email}
                      onChange={(e) => setCsInfo(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                      placeholder="support@embrain.com"
                    />
                  </div>
                </div>

                {/* 표시 항목 토글 */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-700">표시 항목</p>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fallbackConfig.showPhone}
                      onChange={(e) => setFallbackConfig(prev => ({ ...prev, showPhone: e.target.checked }))}
                      className="w-4 h-4 text-red-500 rounded focus:ring-red-400"
                    />
                    <span className="text-sm text-gray-600">전화 문의 안내 표시</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fallbackConfig.showEmail}
                      onChange={(e) => setFallbackConfig(prev => ({ ...prev, showEmail: e.target.checked }))}
                      className="w-4 h-4 text-red-500 rounded focus:ring-red-400"
                    />
                    <span className="text-sm text-gray-600">이메일 문의 안내 표시</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fallbackConfig.showFaqGuide}
                      onChange={(e) => setFallbackConfig(prev => ({ ...prev, showFaqGuide: e.target.checked }))}
                      className="w-4 h-4 text-red-500 rounded focus:ring-red-400"
                    />
                    <span className="text-sm text-gray-600">자주 묻는 질문 안내 표시</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">추가 안내 문구 (선택)</label>
                  <textarea
                    rows={2}
                    value={fallbackConfig.additionalMessage}
                    onChange={(e) => setFallbackConfig(prev => ({ ...prev, additionalMessage: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-transparent"
                    placeholder="예: 빠른 시일 내에 답변을 준비하겠습니다. 감사합니다."
                  />
                </div>

                {/* 버튼 */}
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleSaveFallback}
                    className="flex items-center px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    저장
                  </button>
                  <button
                    onClick={handleResetFallback}
                    className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    기본값 복원
                  </button>
                </div>
              </div>

              {/* 우측: 미리보기 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">미리보기</h3>
                <div className="bg-gray-100 rounded-2xl p-4">
                  <div className="flex items-start space-x-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <span className="text-xs font-medium text-gray-500 mt-2">챗봇</span>
                  </div>
                  <div className="bg-white rounded-xl px-4 py-3 shadow-sm">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                      {buildFallbackPreview(fallbackConfig, csInfo)}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 mt-2 text-right">사용자가 등록되지 않은 질문을 했을 때 표시됩니다</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="FAQ 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-80"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div className="text-sm text-gray-600">
            총 {filteredFaqs.length}개의 FAQ
          </div>
        </div>
      </div>

      {/* FAQ List */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 tracking-wider">질문 / 답변 / 카테고리</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 tracking-wider">활성 상태</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 tracking-wider">즐겨찾기 / 테스트 / 편집 / 삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedFaqs.map((faq) => (
                <tr key={faq.id} className="hover:bg-gray-50 transition-colors duration-200">
                  <td className="px-6 py-4">
                    <div className="max-w-2xl">
                      <p className="text-sm font-medium text-black">{faq.question}</p>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{faq.answer}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {faq.category}
                        </span>
                        {faq.sourceDocument ? (
                          <button
                            onClick={() => handleDownloadDocument(faq.sourceDocument!.id, faq.sourceDocument!.name)}
                            className="flex items-center space-x-1 hover:bg-gray-100 px-2 py-1 rounded transition-colors duration-200 group"
                            title={`${faq.sourceDocument.name} 다운로드`}
                          >
                            <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="text-xs text-gray-600 group-hover:text-blue-600 truncate max-w-xs">
                              {faq.sourceDocument.name}
                            </span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">수동 생성</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggleActive(faq.id)}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200 ${
                        faq.isActive
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-red-100 text-red-800 hover:bg-red-200'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full mr-2 ${faq.isActive ? 'bg-green-400' : 'bg-red-400'}`}></div>
                      {faq.isActive ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleToggleFeatured(faq.id)}
                        className={`p-2 rounded-lg transition-colors duration-200 ${
                          faq.isFeatured
                            ? 'text-yellow-600 bg-yellow-50 hover:bg-yellow-100'
                            : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                        }`}
                        title={faq.isFeatured ? '자주 묻는 질문에서 제거' : '자주 묻는 질문에 추가'}
                      >
                        <svg className="w-4 h-4" fill={faq.isFeatured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                      {onTestFaq && (
                        <button
                          onClick={() => onTestFaq(faq)}
                          className="text-green-600 hover:text-green-700 p-2 hover:bg-green-50 rounded-lg transition-colors duration-200"
                          title="채팅에서 테스트"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleEditFaq(faq)}
                        className="text-blue-600 hover:text-blue-700 p-2 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                        title="편집"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteFaq(faq.id)}
                        className="text-red-600 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors duration-200"
                        title="삭제"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginatedFaqs.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                      </svg>
                      <p className="text-gray-500 text-sm font-medium">
                        {searchTerm || selectedCategory !== '전체' ? '검색 결과가 없습니다' : '등록된 FAQ가 없습니다'}
                      </p>
                      <p className="text-gray-400 text-xs mt-1">
                        {searchTerm || selectedCategory !== '전체' ? '검색어나 카테고리를 변경해보세요' : '새 FAQ를 추가하거나 문서에서 자동 생성하세요'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredFaqs.length)} / {filteredFaqs.length}개 표시
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  이전
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-2 text-sm font-medium rounded-lg ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingFaq ? 'FAQ 편집' : '새 FAQ 추가'}
      >
        <FaqForm
          faq={editingFaq}
          onSave={handleSaveFaq}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>
    </div>
  );
};

// FAQ Form Component
interface FaqFormProps {
  faq: FAQ | null;
  onSave: (faq: Omit<FAQ, 'id'>) => void;
  onCancel: () => void;
}

const FaqForm: React.FC<FaqFormProps> = ({ faq, onSave, onCancel }) => {
  const [formData, setFormData] = useState({
    question: faq?.question || '',
    answer: faq?.answer || '',
    category: faq?.category || '일반',
    isActive: faq?.isActive ?? true,
    imageUrl: faq?.imageUrl || '',
    linkUrl: faq?.linkUrl || '',
    attachmentUrl: faq?.attachmentUrl || '',
    attachmentName: faq?.attachmentName || ''
  });

  const baseCategories = ['조사 의뢰 및 견적 문의', '주식 및 IR 관련 문의', '기타 문의상담', '계좌', '대출', '송금', '온라인뱅킹', '일반'];
  // 편집 시 FAQ의 기존 카테고리가 목록에 없으면 포함
  const categories = useMemo(() => {
    if (faq?.category && !baseCategories.includes(faq.category)) {
      return [faq.category, ...baseCategories];
    }
    return baseCategories;
  }, [faq]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">질문</label>
        <input
          type="text"
          required
          value={formData.question}
          onChange={(e) => setFormData(prev => ({ ...prev, question: e.target.value }))}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="질문을 입력하세요"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">답변</label>
        <textarea
          required
          rows={4}
          value={formData.answer}
          onChange={(e) => setFormData(prev => ({ ...prev, answer: e.target.value }))}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="답변을 입력하세요"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">카테고리</label>
        <select
          value={formData.category}
          onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {categories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">이미지 URL (선택)</label>
        <input
          type="url"
          value={formData.imageUrl || ''}
          onChange={(e) => setFormData(prev => ({ ...prev, imageUrl: e.target.value }))}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="https://example.com/image.png"
        />
        <p className="mt-1 text-xs text-gray-500">당첨자 발표 이미지 등을 표시할 수 있습니다</p>
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="isActive"
          checked={formData.isActive}
          onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="isActive" className="ml-2 text-sm font-medium text-gray-600">
          활성화
        </label>
      </div>

      <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-3 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors duration-200"
        >
          취소
        </button>
        <button
          type="submit"
          className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
        >
          저장
        </button>
      </div>
    </form>
  );
};

export default FaqManagement;
