import React, { useState, useMemo, useEffect } from 'react';
import { PDFDocument, FAQ } from '../types';
import { getSupabaseStorageService } from '../services/supabase';

interface PDFDocumentViewerProps {
  document: PDFDocument;
  onClose: () => void;
  onUpdateFAQs: (documentId: number, faqs: FAQ[]) => void;
}

const PDFDocumentViewer: React.FC<PDFDocumentViewerProps> = ({
  document,
  onClose,
  onUpdateFAQs
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'ocr' | 'content' | 'faqs' | 'metadata'>('overview');
  const [editingFAQ, setEditingFAQ] = useState<FAQ | null>(null);
  const [isAddingFAQ, setIsAddingFAQ] = useState(false);
  const [newFAQ, setNewFAQ] = useState<Partial<FAQ>>({
    question: '',
    answer: '',
    category: '문서',
    isActive: true
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const storageService = useMemo(() => getSupabaseStorageService(), []);

  const faqs = document.generatedFaqs || [];
  const metadata = document.metadata;

  // Load PDF preview URL if available
  useEffect(() => {
    const loadPreviewUrl = async () => {
      if (document.filePath && document.filePath.toLowerCase().endsWith('.pdf')) {
        try {
          const signedUrl = await storageService.download(document.filePath);
          setPdfPreviewUrl(signedUrl);
        } catch (error) {
          console.error('Failed to load PDF preview:', error);
        }
      }
    };

    loadPreviewUrl();

    // Cleanup
    return () => {
      setPdfPreviewUrl(null);
    };
  }, [document.filePath, storageService]);

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const pageContents = useMemo(() => {
    if (document.chunks && document.chunks.length > 0) {
      const chunkMap = new Map<number, string[]>();
      let maxPageFromChunks = 0;

      document.chunks.forEach((chunk) => {
        const pageNumber = chunk.pageNumber || 1;
        maxPageFromChunks = Math.max(maxPageFromChunks, pageNumber);
        const list = chunkMap.get(pageNumber) || [];
        list.push(chunk.content?.trim() || '');
        chunkMap.set(pageNumber, list);
      });

      const totalPages = metadata?.pages && metadata.pages > 0
        ? Math.max(metadata.pages, maxPageFromChunks)
        : Math.max(maxPageFromChunks, 1);

      return Array.from({ length: totalPages }, (_, index) => {
        const pageNumber = index + 1;
        const text = (chunkMap.get(pageNumber) || []).filter(Boolean).join('\n\n').trim();
        return {
          pageNumber,
          text
        };
      });
    }

    if (metadata?.textContent) {
      return [
        {
          pageNumber: 1,
          text: metadata.textContent.trim()
        }
      ];
    }

    return [];
  }, [document, metadata]);

  useEffect(() => {
    setCurrentPage((prev) => {
      if (pageContents.length === 0) {
        return 1;
      }
      if (prev > pageContents.length) {
        return pageContents.length;
      }
      if (prev < 1) {
        return 1;
      }
      return prev;
    });
  }, [pageContents.length]);

  const normalizedSearchTerm = searchTerm.trim();

  const searchResults = useMemo(() => {
    const perPageMatches = new Map<number, number>();
    let totalMatches = 0;

    if (!normalizedSearchTerm) {
      return {
        totalMatches,
        perPageMatches,
        matchingPages: [] as number[]
      };
    }

    const regex = new RegExp(escapeRegExp(normalizedSearchTerm), 'gi');

    pageContents.forEach(({ pageNumber, text }) => {
      if (!text) {
        return;
      }
      const matches = text.match(regex);
      if (matches && matches.length > 0) {
        perPageMatches.set(pageNumber, matches.length);
        totalMatches += matches.length;
      }
    });

    const matchingPages = Array.from(perPageMatches.keys()).sort((a, b) => a - b);

    return {
      totalMatches,
      perPageMatches,
      matchingPages
    };
  }, [normalizedSearchTerm, pageContents]);

  useEffect(() => {
    if (!normalizedSearchTerm || searchResults.matchingPages.length === 0) {
      return;
    }
    const firstMatchPage = searchResults.matchingPages[0];
    if (firstMatchPage !== currentPage) {
      setCurrentPage(firstMatchPage);
    }
  }, [normalizedSearchTerm, searchResults.matchingPages, currentPage]);

  const highlightText = (text: string) => {
    if (!normalizedSearchTerm) {
      return text;
    }

    const regex = new RegExp(`(${escapeRegExp(normalizedSearchTerm)})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) => (
      index % 2 === 1 ? (
        <mark key={index} className="bg-yellow-200 text-black">
          {part}
        </mark>
      ) : (
        <React.Fragment key={index}>{part}</React.Fragment>
      )
    ));
  };

  const totalPages = pageContents.length;
  const currentPageContent = totalPages > 0 ? pageContents[Math.min(currentPage - 1, totalPages - 1)] : null;

  const gotoPage = (pageNumber: number) => {
    if (totalPages === 0) {
      return;
    }
    const nextPage = Math.min(Math.max(pageNumber, 1), totalPages);
    setCurrentPage(nextPage);
  };

  const buildPageButtons = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const buttons: (number | 'ellipsis')[] = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) {
      buttons.push('ellipsis');
    }

    for (let page = start; page <= end; page += 1) {
      buttons.push(page);
    }

    if (end < totalPages - 1) {
      buttons.push('ellipsis');
    }

    buttons.push(totalPages);
    return buttons;
  };

  const handleAddFAQ = () => {
    if (newFAQ.question && newFAQ.answer) {
      const faq: FAQ = {
        id: Date.now(),
        question: newFAQ.question,
        answer: newFAQ.answer,
        category: newFAQ.category || '문서',
        isActive: true
      };

      const updatedFAQs = [...faqs, faq];
      onUpdateFAQs(document.id, updatedFAQs);
      setNewFAQ({ question: '', answer: '', category: '문서', isActive: true });
      setIsAddingFAQ(false);
    }
  };

  const handleEditFAQ = (faq: FAQ) => {
    setEditingFAQ({ ...faq });
  };

  const handleSaveFAQ = () => {
    if (editingFAQ) {
      const updatedFAQs = faqs.map(faq =>
        faq.id === editingFAQ.id ? editingFAQ : faq
      );
      onUpdateFAQs(document.id, updatedFAQs);
      setEditingFAQ(null);
    }
  };

  const handleDeleteFAQ = (faqId: number) => {
    if (confirm('이 FAQ를 삭제하시겠습니까?')) {
      const updatedFAQs = faqs.filter(faq => faq.id !== faqId);
      onUpdateFAQs(document.id, updatedFAQs);
    }
  };

  const toggleFAQStatus = (faqId: number) => {
    const updatedFAQs = faqs.map(faq =>
      faq.id === faqId ? { ...faq, isActive: !faq.isActive } : faq
    );
    onUpdateFAQs(document.id, updatedFAQs);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '처리 완료';
      case 'processing':
        return '처리 중';
      case 'error':
        return '오류';
      default:
        return status;
    }
  };

  const isImageFile = (fileName: string): boolean => {
    return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
  };

  const tabs = [
    { id: 'overview', name: '개요', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'ocr', name: 'OCR', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'content', name: '내용', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V19a2 2 0 01-2 2z' },
    { id: 'faqs', name: 'FAQ 관리', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">{document.name}</h2>
              <div className="flex items-center mt-1 space-x-4">
                <span className="text-blue-100 text-sm">{document.size}</span>
                <span className="text-blue-100 text-sm">{document.uploadDate}</span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(document.status)}`}>
                  {getStatusText(document.status)}
                </span>
                <span className="text-blue-100 text-sm">
                  {document.uploadMode === 'general' ? '일반 모드' : 'DeepSeek OCR 모드'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-600 hover:border-gray-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                <span>{tab.name}</span>
                {tab.id === 'faqs' && faqs.length > 0 && (
                  <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                    {faqs.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-blue-900">페이지 수</p>
                      <p className="text-lg font-bold text-blue-600">{metadata?.pages || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-lg p-4">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-green-900">생성된 FAQ</p>
                      <p className="text-lg font-bold text-green-600">{faqs.length}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-purple-900">청크 수</p>
                      <p className="text-lg font-bold text-purple-600">{document.chunks?.length || 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* PDF/Image Preview */}
              {document.filePath && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-black mb-3">문서 미리보기</h4>
                  {isImageFile(document.name) ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <img
                        src={metadata?.images?.[0]?.url || ''}
                        alt={document.name}
                        className="w-full h-auto max-h-96 object-contain bg-white"
                      />
                    </div>
                  ) : pdfPreviewUrl ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <iframe
                        src={pdfPreviewUrl}
                        className="w-full h-96"
                        title={document.name}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">미리보기를 불러오는 중...</p>
                  )}
                </div>
              )}

              {document.uploadMode === 'deepseek_ocr' && metadata && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-black mb-3">추출된 리소스</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">이미지</p>
                      <p className="font-medium">{metadata.images?.length || 0}개</p>
                    </div>
                    <div>
                      <p className="text-gray-600">그래프</p>
                      <p className="font-medium">{metadata.graphs?.length || 0}개</p>
                    </div>
                    <div>
                      <p className="text-gray-600">테이블</p>
                      <p className="font-medium">{metadata.tables?.length || 0}개</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* OCR Tab */}
          {activeTab === 'ocr' && (
            <div className="space-y-5">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-blue-900">OCR 원본 전문</h3>
                </div>
                <p className="text-sm text-blue-700 mt-2">
                  PDF에서 추출된 원본 OCR 텍스트입니다. AI 처리나 요약 없이 있는 그대로 표시됩니다.
                </p>
              </div>

              {document.ocrText ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 min-h-[400px] max-h-[600px] overflow-y-auto">
                  <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-mono">
                    {document.ocrText}
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <svg className="w-12 h-12 text-yellow-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-yellow-800 font-medium">OCR 원본 텍스트가 없습니다</p>
                  <p className="text-sm text-yellow-600 mt-2">
                    이 문서는 OCR 처리가 완료되지 않았거나 원본 텍스트가 저장되지 않았습니다.
                  </p>
                  <p className="text-xs text-yellow-500 mt-3">
                    참고: 이 기능은 새로 업로드한 문서에만 적용됩니다. 기존 문서는 OCR 원본 텍스트가 저장되지 않았을 수 있습니다.
                  </p>
                  {metadata?.textContent && (
                    <div className="mt-4 p-3 bg-yellow-100 rounded-lg text-left">
                      <p className="text-xs text-yellow-700 font-medium mb-1">AI 처리된 텍스트 (참고용):</p>
                      <p className="text-xs text-yellow-600">
                        원본 OCR 텍스트는 없지만, AI 처리된 텍스트는 "내용" 탭에서 확인할 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {document.ocrText && (
                <div className="bg-gray-100 rounded-lg p-4 text-sm text-gray-600">
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      원본 OCR 텍스트 길이: {document.ocrText.length.toLocaleString()}자
                      {document.ocrText.includes('=== 페이지') && (
                        <span className="ml-2">
                          (페이지 구분 마커 포함)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Tab */}
          {activeTab === 'content' && (
            <div className="space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-center gap-2 w-full lg:w-auto">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="문서 내용 검색 (대소문자 무시)"
                    className="flex-1 lg:w-72 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      초기화
                    </button>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {normalizedSearchTerm
                    ? searchResults.totalMatches > 0
                      ? `검색 결과 ${searchResults.totalMatches}건 / ${searchResults.matchingPages.length}페이지`
                      : '검색 결과가 없습니다.'
                    : totalPages > 0
                      ? `총 ${totalPages}페이지`
                      : '텍스트가 없습니다.'}
                </div>
              </div>

              {normalizedSearchTerm && searchResults.matchingPages.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {searchResults.matchingPages.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      onClick={() => gotoPage(pageNumber)}
                      className={`px-3 py-1 rounded-full border transition-colors ${
                        currentPage === pageNumber
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
                      }`}
                    >
                      페이지 {pageNumber}
                      {searchResults.perPageMatches.get(pageNumber) && (
                        <span className="ml-1 text-xs">
                          ({searchResults.perPageMatches.get(pageNumber)})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 min-h-[320px] max-h-[420px] overflow-y-auto">
                {totalPages === 0 && (
                  <div className="text-sm text-gray-500">
                    문서에서 추출된 텍스트가 없습니다. OCR 처리가 완료되었는지 확인해주세요.
                  </div>
                )}
                {totalPages > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>
                        페이지 {currentPageContent?.pageNumber ?? currentPage} / {totalPages}
                      </span>
                      {normalizedSearchTerm && searchResults.perPageMatches.get(currentPageContent?.pageNumber || 0) && (
                        <span>
                          현재 페이지 검색 결과 {searchResults.perPageMatches.get(currentPageContent?.pageNumber || 0)}건
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                      {currentPageContent && currentPageContent.text
                        ? highlightText(currentPageContent.text)
                        : '이 페이지에는 표시할 텍스트가 없습니다.'}
                    </div>
                  </div>
                )}
              </div>

              {totalPages > 0 && (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="text-sm text-gray-600">
                    총 {totalPages}페이지 중 {currentPage}페이지
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => gotoPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      이전
                    </button>
                    {buildPageButtons().map((item, index) => (
                      item === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-2 text-gray-400">
                          ...
                        </span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => gotoPage(item as number)}
                          className={`px-3 py-2 text-sm rounded-lg border ${
                            currentPage === item
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {item}
                        </button>
                      )
                    ))}
                    <button
                      onClick={() => gotoPage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                      className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}

              {document.chunks && document.chunks.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-black mb-3">추출 청크 미리보기</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {document.chunks.map((chunk, index) => (
                      <div key={chunk.id ?? `chunk-${index}`} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-gray-500">
                            청크 {index + 1} (페이지 {chunk.pageNumber})
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                          {chunk.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FAQ Management Tab */}
          {activeTab === 'faqs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">FAQ 관리</h3>
                <button
                  onClick={() => setIsAddingFAQ(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>FAQ 추가</span>
                </button>
              </div>

              {/* Add FAQ Form */}
              {isAddingFAQ && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-900 mb-3">새 FAQ 추가</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-blue-900 mb-1">질문</label>
                      <input
                        type="text"
                        value={newFAQ.question}
                        onChange={(e) => setNewFAQ(prev => ({ ...prev, question: e.target.value }))}
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                        placeholder="질문을 입력하세요"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-900 mb-1">답변</label>
                      <textarea
                        value={newFAQ.answer}
                        onChange={(e) => setNewFAQ(prev => ({ ...prev, answer: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                        placeholder="답변을 입력하세요"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-900 mb-1">카테고리</label>
                      <select
                        value={newFAQ.category}
                        onChange={(e) => setNewFAQ(prev => ({ ...prev, category: e.target.value }))}
                        className="px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                      >
                        <option value="문서">문서</option>
                        <option value="계좌">계좌</option>
                        <option value="대출">대출</option>
                        <option value="송금">송금</option>
                        <option value="일반">일반</option>
                      </select>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={handleAddFAQ}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        추가
                      </button>
                      <button
                        onClick={() => {
                          setIsAddingFAQ(false);
                          setNewFAQ({ question: '', answer: '', category: '문서', isActive: true });
                        }}
                        className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* FAQ List */}
              <div className="space-y-3">
                {faqs.map((faq) => (
                  <div key={faq.id} className="bg-white border border-gray-200 rounded-lg p-4">
                    {editingFAQ && editingFAQ.id === faq.id ? (
                      // Edit Mode
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">질문</label>
                          <input
                            type="text"
                            value={editingFAQ.question}
                            onChange={(e) => setEditingFAQ(prev => prev ? { ...prev, question: e.target.value } : null)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">답변</label>
                          <textarea
                            value={editingFAQ.answer}
                            onChange={(e) => setEditingFAQ(prev => prev ? { ...prev, answer: e.target.value } : null)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                          />
                        </div>
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={handleSaveFAQ}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => setEditingFAQ(null)}
                            className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View Mode
                      <div>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h5 className="font-semibold text-black">{faq.question}</h5>
                            <p className="text-gray-600 mt-1">{faq.answer}</p>
                          </div>
                          <div className="flex items-center space-x-2 ml-4">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              faq.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {faq.isActive ? '활성' : '비활성'}
                            </span>
                            <button
                              onClick={() => toggleFAQStatus(faq.id)}
                              className="text-blue-600 hover:text-blue-700 p-1"
                              title={faq.isActive ? '비활성화' : '활성화'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleEditFAQ(faq)}
                              className="text-yellow-600 hover:text-yellow-700 p-1"
                              title="편집"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteFAQ(faq.id)}
                              className="text-red-600 hover:text-red-700 p-1"
                              title="삭제"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center text-sm text-gray-500">
                          <span className="bg-gray-100 px-2 py-1 rounded-full">{faq.category}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {faqs.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>생성된 FAQ가 없습니다.</p>
                    <p className="text-sm">위 버튼을 클릭하여 FAQ를 추가해보세요.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PDFDocumentViewer;
