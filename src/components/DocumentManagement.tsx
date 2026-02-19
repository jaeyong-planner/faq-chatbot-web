import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FAQ, PDFDocument } from '../types';
import PDFUploadModal from './PDFUploadModal';
import PDFDocumentViewer from './PDFDocumentViewer';
import DatabaseSettings from './DatabaseSettings';
import { getSupabaseDatabaseService, getSupabaseStorageService } from '../services/supabase';
import { useToast } from './Toast';
import { createLogger } from '../services/logger';
import * as XLSX from 'xlsx';

const log = createLogger('DocMgmt');
interface DocumentManagementProps {
  setFaqs: React.Dispatch<React.SetStateAction<FAQ[]>>;
}


const DocumentManagement: React.FC<DocumentManagementProps> = ({ setFaqs }) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isDatabaseSettingsOpen, setIsDatabaseSettingsOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<PDFDocument | null>(null);
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);
  const storageService = useMemo(() => getSupabaseStorageService(), []);
  const { showToast } = useToast();
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [isExcelUploading, setIsExcelUploading] = useState(false);

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      showToast('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.', 'error');
      return;
    }

    setIsExcelUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);

      const allFaqs: { question: string; answer: string; category: string }[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

        for (const row of rows) {
          const question = (row['질문'] || '').trim();
          const answer = (row['답변'] || '').trim();
          if (question && answer) {
            allFaqs.push({ question, answer, category: sheetName });
          }
        }
      }

      if (allFaqs.length === 0) {
        showToast('엑셀에서 FAQ 데이터를 찾을 수 없습니다. "질문"과 "답변" 열이 필요합니다.', 'error');
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const faq of allFaqs) {
        try {
          await dbService.createFAQ({
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            isActive: true,
          } as Omit<FAQ, 'id'>);
          successCount++;
        } catch (err) {
          log.error('FAQ 저장 실패:', err);
          failCount++;
        }
      }

      await loadFAQs();
      showToast(
        `엑셀 업로드 완료: ${successCount}건 등록${failCount > 0 ? `, ${failCount}건 실패` : ''}`,
        failCount > 0 ? 'warning' : 'success'
      );
    } catch (err) {
      log.error('엑셀 파싱 실패:', err);
      showToast('엑셀 파일 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsExcelUploading(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  // Load documents from database on component mount
  useEffect(() => {
    loadDocuments();
    loadFAQs();
  }, []);

  const loadDocuments = async () => {
    try {
      setIsLoading(true);
      setError(null);
      log.debug('Loading documents from database...');

      const dbDocuments = await dbService.getAllDocuments();
      log.debug('Loaded documents:', dbDocuments.length);

      setDocuments(dbDocuments);

      setLastRefresh(new Date());
    } catch (error) {
      log.error('Failed to load documents:', error);
      setError('문서를 불러오는데 실패했습니다. 데이터베이스 연결을 확인해주세요.');
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFAQs = async () => {
    try {
      log.debug('Loading FAQs from database...');
      const dbFAQs = await dbService.getAllFAQs();
      log.debug('Loaded FAQs:', dbFAQs.length);
      setFaqs(dbFAQs);
    } catch (error) {
      log.error('Failed to load FAQs:', error);
    }
  };

  const handleRefresh = async () => {
    log.debug('Manual refresh triggered');
    await loadDocuments();
    await loadFAQs();
  };

  const handleUploadComplete = async (newDocuments: PDFDocument[]) => {
    // Documents should be saved to database during upload process
    // Just reload from database to get the latest state
    await loadDocuments();
    await loadFAQs();

    // Web Gemini Service 기반 문서 분석 및 임베딩 생성
    log.debug('🚀 Web Gemini Service 기반 문서 분석 시작...');
    const { WebGeminiService } = await import('../services/WebGeminiService');
    const webGeminiService = WebGeminiService.getInstance();

    for (const doc of newDocuments) {
      try {
        // 1. Gemini로 문서 재분석 및 추가 FAQ 생성
        if (doc.metadata?.textContent) {
          log.debug(`📄 문서 ${doc.id} (${doc.name}) Gemini 분석 시작...`);

          const analysisResult = await webGeminiService.analyzeDocument(
            doc.metadata.textContent,
            doc.name
          );

          log.debug(`✅ Gemini 분석 완료:`, {
            summary: analysisResult.summary.substring(0, 100) + '...',
            keyTopics: analysisResult.keyTopics.length,
            suggestedFAQs: analysisResult.suggestedFAQs.length
          });

          // 2. 생성된 FAQ를 데이터베이스에 저장
          for (const suggestedFaq of analysisResult.suggestedFAQs) {
            try {
              await dbService.createFAQ({
                question: suggestedFaq.question,
                answer: suggestedFaq.answer,
                category: suggestedFaq.category || '일반',
                isActive: true
              }, doc.id);
              log.debug(`✅ FAQ 저장 완료: ${suggestedFaq.question.substring(0, 50)}...`);
            } catch (error) {
              log.error(`FAQ 저장 실패:`, error);
            }
          }
        }

        // 3. 문서 청크에 대한 임베딩 생성 (Gemini 사용)
        const chunks = await dbService.getChunksByDocumentId(doc.id);
        if (chunks.length > 0) {
          log.debug(`🔢 문서 ${doc.id}의 청크 ${chunks.length}개에 대한 임베딩 생성 시작...`);

          const chunkTexts = chunks.map(chunk => chunk.content);
          const embeddings = await webGeminiService.generateBatchEmbeddings(chunkTexts);

          // 청크 임베딩 업데이트
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = embeddings[i];

            if (embedding && embedding.length > 0) {
              await dbService.updateChunk(chunk.id, {
                ...chunk,
                embeddings: embedding
              });
            }
          }

          log.debug(`✅ 청크 임베딩 생성 완료: ${chunks.length}개`);
        }

        // 4. FAQ에 대한 임베딩 생성 (Gemini 사용)
        const faqs = await dbService.getFAQsByDocumentId(doc.id);
        if (faqs.length > 0) {
          log.debug(`❓ 문서 ${doc.id}의 FAQ ${faqs.length}개에 대한 임베딩 생성 시작...`);

          for (const faq of faqs) {
            try {
              // 질문과 답변에 대한 임베딩 생성
              const [questionEmbedding, answerEmbedding] = await webGeminiService.generateBatchEmbeddings([
                faq.question,
                faq.answer
              ]);

              // FAQ 임베딩 업데이트
              await dbService.updateFAQ(faq.id, {
                ...faq,
                questionEmbedding,
                answerEmbedding
              });

              log.debug(`✅ FAQ 임베딩 생성 완료: ${faq.question.substring(0, 50)}...`);
            } catch (error) {
              log.error(`FAQ ${faq.id} 임베딩 생성 실패:`, error);
            }
          }
        }

        log.debug(`🎉 문서 ${doc.id} (${doc.name}) 처리 완료!`);
      } catch (error: any) {
        log.error(`문서 ${doc.id} Gemini 처리 실패:`, error);
        log.warn(`⚠️  문서 ${doc.id}는 기본 처리만 완료되었습니다.`);
      }
    }

    // 모든 처리 완료 후 다시 로드
    await loadDocuments();
    await loadFAQs();
    log.debug('✨ 모든 문서 처리 완료!');
  };

  const handleDocumentClick = (document: PDFDocument) => {
    setSelectedDocument(document);
  };

  const handleUpdateFAQs = async (documentId: number, updatedFAQs: FAQ[]) => {
    try {
      // Update FAQs in database
      // First get existing FAQs for this document
      const existingFAQs = await dbService.getFAQsByDocumentId(documentId);

      // Delete removed FAQs
      for (const existingFAQ of existingFAQs) {
        if (!updatedFAQs.find(faq => faq.id === existingFAQ.id)) {
          await dbService.deleteFAQ(existingFAQ.id);
        }
      }

      // Update or create FAQs
      for (const faq of updatedFAQs) {
        if (faq.id && existingFAQs.find(f => f.id === faq.id)) {
          // Update existing FAQ
          await dbService.updateFAQ(faq.id, faq);
        } else if (!faq.id) {
          // Create new FAQ
          await dbService.createFAQ(faq, documentId);
        }
      }

      // Reload data from database
      await loadDocuments();
      await loadFAQs();
      showToast('FAQ가 성공적으로 업데이트되었습니다.', 'success');
    } catch (error) {
      log.error('Failed to update FAQs:', error);
      showToast('FAQ 업데이트에 실패했습니다.', 'error');
    }
  };

  const handleDownloadDocument = async (doc: PDFDocument) => {
    try {
      // Check if document has filePath
      if (!doc.filePath) {
        showToast('이 문서는 파일이 저장되지 않아 다운로드할 수 없습니다.\n\n문서를 다시 업로드하면 다운로드가 가능합니다.', 'warning');
        return;
      }

      // Get signed URL from Supabase Storage
      const signedUrl = await storageService.download(doc.filePath);

      if (signedUrl) {
        // Open the signed URL in a new tab to trigger download
        window.open(signedUrl, '_blank');
        showToast('문서 다운로드를 시작합니다.', 'success');
      } else {
        showToast('문서 다운로드에 실패했습니다.', 'error');
      }
    } catch (error) {
      log.error('문서 다운로드 실패:', error);
      showToast('문서 다운로드 중 오류가 발생했습니다.', 'error');
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (confirm('이 문서를 삭제하시겠습니까? 관련된 FAQ와 청크도 함께 삭제됩니다.')) {
      try {
        // Get document to find filePath
        const document = documents.find(d => d.id === documentId);

        // Delete from storage first if filePath exists
        if (document?.filePath) {
          try {
            await storageService.delete(document.filePath);
            log.debug('File deleted from storage:', document.filePath);
          } catch (error) {
            log.warn('Failed to delete file from storage:', error);
            // Continue with DB deletion even if storage deletion fails
          }
        }

        // Delete from database
        await dbService.deleteDocument(documentId);

        // Reload data from database
        await loadDocuments();
        await loadFAQs();
        showToast('문서가 성공적으로 삭제되었습니다.', 'success');
      } catch (error) {
        log.error('Failed to delete document:', error);
        showToast('문서 삭제에 실패했습니다.', 'error');
      }
    }
  };

  const handleDatabaseSettingsChanged = async () => {
    // Reload data when database settings change
    await loadDocuments();
    await loadFAQs();
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

  const getFileIcon = (fileName: string, doc?: PDFDocument) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);

    // For image files, show thumbnail
    if (isImage && doc?.metadata?.images?.[0]?.url) {
      return (
        <div
          className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedImage(doc.metadata!.images![0].url);
          }}
        >
          <img
            src={doc.metadata.images[0].url}
            alt={fileName}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    switch (extension) {
      case 'pdf':
        return (
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
          </div>
        );
      case 'xlsx':
      case 'xls':
        return (
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
          </div>
        );
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'bmp':
        return (
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
          </div>
        );
    }
  };

  const completedDocs = documents.filter(doc => doc.status === 'completed').length;
  const processingDocs = documents.filter(doc => doc.status === 'processing').length;
  const totalSize = documents.reduce((sum, doc) => {
    const sizeValue = parseFloat(doc.size.split(' ')[0]);
    const unit = doc.size.split(' ')[1];
    return sum + (unit === 'MB' ? sizeValue : sizeValue / 1024);
  }, 0);
  const totalFAQs = documents.reduce((sum, doc) => sum + (doc.generatedFaqs?.length || 0), 0);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-black">문서 관리</h1>
              <p className="text-gray-600 mt-1">AI 학습을 위한 PDF 문서를 업로드하고 FAQ를 관리하세요</p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 transition-all duration-200 flex items-center disabled:opacity-50"
                title="새로고침"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isLoading ? '새로고침 중...' : '새로고침'}
              </button>
              <button
                onClick={() => setIsDatabaseSettingsOpen(true)}
                className="bg-gray-600 text-white px-4 py-3 rounded-lg hover:bg-gray-700 transition-all duration-200 flex items-center"
                title="데이터베이스 설정"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                DB 설정
              </button>
              <button
                onClick={() => excelInputRef.current?.click()}
                disabled={isExcelUploading}
                className="bg-emerald-600 text-white px-4 py-3 rounded-lg hover:bg-emerald-700 transition-all duration-200 flex items-center disabled:opacity-50"
                title="엑셀 FAQ 업로드"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {isExcelUploading ? '업로드 중...' : '엑셀 FAQ'}
              </button>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleExcelUpload}
                className="hidden"
              />
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-3 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                문서 업로드
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">총 문서 수</p>
                <p className="text-2xl font-bold text-black">{documents.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">처리 완료</p>
                <p className="text-2xl font-bold text-black">{completedDocs}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">처리 중</p>
                <p className="text-2xl font-bold text-black">{processingDocs}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">생성된 FAQ</p>
                <p className="text-2xl font-bold text-black">{totalFAQs}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Status Display */}
        {error && (
          <div className={`border rounded-xl p-6 ${
            error.includes('샘플 데이터')
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center">
              <div className="flex-shrink-0">
                {error.includes('샘플 데이터') ? (
                  <svg className="h-5 w-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <h3 className={`text-sm font-medium ${
                  error.includes('샘플 데이터') ? 'text-yellow-800' : 'text-red-800'
                }`}>
                  {error.includes('샘플 데이터') ? '데모 모드 (샘플 데이터)' : '데이터베이스 연결 오류'}
                </h3>
                <div className={`mt-2 text-sm ${
                  error.includes('샘플 데이터') ? 'text-yellow-700' : 'text-red-700'
                }`}>
                  <p>{error}</p>
                  <p className="mt-1">마지막 새로고침: {lastRefresh.toLocaleTimeString()}</p>
                </div>
              </div>
              <div className="ml-auto">
                <button
                  onClick={handleRefresh}
                  className={`px-3 py-1 rounded-lg transition-colors text-sm ${
                    error.includes('샘플 데이터')
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-red-100 text-red-800 hover:bg-red-200'
                  }`}
                >
                  다시 시도
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document List */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-black">업로드된 문서</h3>
              <span className="text-sm text-gray-500">
                마지막 새로고침: {lastRefresh.toLocaleTimeString()}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-lg text-gray-500">데이터베이스에서 문서를 불러오는 중...</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg text-gray-500 mb-2">아직 업로드된 문서가 없습니다</p>
              <p className="text-sm text-gray-400 mb-4">위 버튼을 클릭하여 PDF 문서를 업로드해보세요</p>
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                첫 문서 업로드
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">문서명</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">크기</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">업로드 날짜</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">모드</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FAQ 수</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50 transition-colors duration-200">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {getFileIcon(doc.name, doc)}
                          <div className="ml-4">
                            <button
                              onClick={() => handleDocumentClick(doc)}
                              className="text-sm font-medium text-black hover:text-blue-700 cursor-pointer"
                            >
                              {doc.name}
                            </button>
                            <p className="text-xs text-gray-500">
                              {doc.metadata?.pages ? `${doc.metadata.pages}페이지` : '처리 중'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {doc.size}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {doc.uploadDate}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          일반
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(doc.status)}`}>
                          {getStatusText(doc.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className="bg-gray-100 px-2 py-1 rounded-full text-xs">
                          {doc.generatedFaqs?.length || 0}개
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleDocumentClick(doc)}
                            className="text-blue-600 hover:text-blue-700 p-2 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                            title="상세 보기"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDownloadDocument(doc)}
                            disabled={!doc.filePath}
                            className={`p-2 rounded-lg transition-colors duration-200 ${
                              doc.filePath
                                ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                                : 'text-gray-400 cursor-not-allowed'
                            }`}
                            title={doc.filePath ? '다운로드' : '다운로드 불가 (문서를 다시 업로드해주세요)'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
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
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* PDF Upload Modal */}
      <PDFUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
      />

      {/* PDF Document Viewer */}
      {selectedDocument && (
        <PDFDocumentViewer
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onUpdateFAQs={handleUpdateFAQs}
        />
      )}

      {/* Database Settings */}
      <DatabaseSettings
        isOpen={isDatabaseSettingsOpen}
        onClose={() => setIsDatabaseSettingsOpen(false)}
        onSettingsChanged={handleDatabaseSettingsChanged}
      />

      {/* Image Expansion Modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <button
              onClick={() => setExpandedImage(null)}
              className="absolute top-4 right-4 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-75 transition-opacity"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={expandedImage}
              alt="Expanded view"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default DocumentManagement;
