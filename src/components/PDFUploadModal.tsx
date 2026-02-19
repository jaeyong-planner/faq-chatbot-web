import React, { useState, useRef, useCallback, useEffect } from "react";
import { PDFDocument, DocumentUploadProgress, GeminiAPIConfig } from "../types";
import { pdfProcessingService } from "../services/pdfProcessingService";
import { defaultConfig } from "../services/config";
import { useToast } from "./Toast";
import { createLogger } from "../services/logger";

const log = createLogger("PDFUpload");
interface PDFUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (documents: PDFDocument[]) => void;
}

const PDFUploadModal: React.FC<PDFUploadModalProps> = ({
  isOpen,
  onClose,
  onUploadComplete,
}) => {
  const { showToast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<
    DocumentUploadProgress[]
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [geminiConfig, setGeminiConfig] = useState<GeminiAPIConfig | null>(
    null,
  );
  const [faqCount, setFaqCount] = useState<number>(5);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlCache = useRef<Map<File, string>>(new Map());

  // Blob URL 메모리 누수 방지: 컴포넌트 언마운트 시 모든 URL 해제
  useEffect(() => {
    return () => {
      previewUrlCache.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      previewUrlCache.current.clear();
    };
  }, []);

  // Load saved API configs on mount
  useEffect(() => {
    if (isOpen) {
      // Load Gemini API config from system settings
      try {
        const savedGeminiConfig = localStorage.getItem("system-gemini-config");
        if (savedGeminiConfig) {
          const parsed = JSON.parse(savedGeminiConfig);
          setGeminiConfig({
            apiKey: parsed.apiKey || "",
            isActive: parsed.isActive || false,
            model: defaultConfig.aiModel.geminiDefaultModel,
            baseUrl: defaultConfig.aiModel.geminiBaseUrl,
          });
        }
      } catch (error) {
        log.error("Failed to load Gemini config:", error);
        setGeminiConfig(null);
      }

      // Load FAQ count setting
      try {
        const savedFaqCount = localStorage.getItem("pdf-upload-faq-count");
        if (savedFaqCount) {
          const parsed = parseInt(savedFaqCount);
          if (parsed >= 1 && parsed <= 20) {
            setFaqCount(parsed);
          }
        }
      } catch (error) {
        log.error("Failed to load FAQ count setting:", error);
        setFaqCount(5); // Default value
      }
    }
  }, [isOpen]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter((file) => {
      const isPDF =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
      const isImage =
        file.type.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name);
      return isPDF || isImage;
    });

    if (files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const files = Array.from(e.target.files);
        setSelectedFiles((prev) => [...prev, ...files]);
        // Reset input value to allow selecting the same file again
        e.target.value = "";
      }
    },
    [],
  );

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        const url = previewUrlCache.current.get(removed);
        if (url) {
          URL.revokeObjectURL(url);
          previewUrlCache.current.delete(removed);
        }
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress([]);

    try {
      // Set FAQ count for AI-enhanced processing (Gemini)
      if (geminiConfig?.isActive && geminiConfig?.apiKey) {
        pdfProcessingService.setFaqCount(faqCount);
      }

      const processedDocuments: PDFDocument[] = [];

      // Process files sequentially
      for (const file of selectedFiles) {
        const onProgress = (progress: DocumentUploadProgress) => {
          setUploadProgress((prev) => {
            const existing = prev.find(
              (p) => p.documentId === progress.documentId,
            );
            if (existing) {
              return prev.map((p) =>
                p.documentId === progress.documentId ? progress : p,
              );
            }
            return [...prev, progress];
          });
        };

        try {
          let document: PDFDocument;
          const isImage = isImageFile(file);

          if (isImage) {
            document = await pdfProcessingService.processGeneralImage(
              file,
              onProgress,
            );
          } else {
            document = await pdfProcessingService.processGeneralPDF(
              file,
              onProgress,
            );
          }

          processedDocuments.push(document);
        } catch (error) {
          log.error(`Failed to process ${file.name}:`, error);
          onProgress({
            documentId: file.name,
            fileName: file.name,
            progress: 0,
            stage: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      onUploadComplete(processedDocuments);
      setSelectedFiles([]);
      setUploadProgress([]);
      onClose();
    } catch (error) {
      log.error("Upload failed:", error);
      showToast("업로드 중 오류가 발생했습니다.", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      // Blob URL 메모리 해제
      selectedFiles.forEach((file) => {
        if (file.type.startsWith("image/")) {
          try {
            const url = previewUrlCache.current.get(file);
            if (url) {
              URL.revokeObjectURL(url);
              previewUrlCache.current.delete(file);
            }
          } catch {
            /* ignore */
          }
        }
      });
      setSelectedFiles([]);
      setUploadProgress([]);
      onClose();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const isImageFile = (file: File): boolean => {
    return (
      file.type.startsWith("image/") ||
      /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name)
    );
  };

  const getFilePreviewURL = (file: File): string | null => {
    if (isImageFile(file)) {
      // 캐시된 URL이 있으면 재사용 (렌더링마다 새 URL 생성 방지)
      const cached = previewUrlCache.current.get(file);
      if (cached) return cached;
      const url = URL.createObjectURL(file);
      previewUrlCache.current.set(file, url);
      return url;
    }
    return null;
  };

  const getStageText = (stage: DocumentUploadProgress["stage"]): string => {
    const stages = {
      uploading: "파일 업로드 중",
      processing: "문서 분석 중",
      extracting:
        geminiConfig?.isActive && geminiConfig?.apiKey
          ? "AI 기반 내용 추출 중"
          : "텍스트 내용 추출 중",
      chunking:
        geminiConfig?.isActive && geminiConfig?.apiKey
          ? "의미적 스마트 청킹 중"
          : "문서 청킹 중",
      generating_faqs:
        geminiConfig?.isActive && geminiConfig?.apiKey
          ? "AI 기반 FAQ 생성 중"
          : "FAQ 생성 중",
      completed: "처리 완료",
      error: "처리 오류",
    };
    return stages[stage] || stage;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-black">
              문서 및 이미지 업로드
            </h2>
            <button
              onClick={handleClose}
              disabled={isUploading}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Processing Mode Info */}
          <div className="border-2 border-blue-500 bg-blue-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-black">PDF 등록 (일반)</h4>
              {geminiConfig?.isActive && geminiConfig?.apiKey ? (
                <div className="flex items-center text-blue-600">
                  <svg
                    className="w-4 h-4 mr-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-xs font-medium">Gemini AI</span>
                </div>
              ) : (
                <div className="flex items-center text-gray-400">
                  <svg
                    className="w-4 h-4 mr-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-xs">기본 모드</span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-600">
              {geminiConfig?.isActive && geminiConfig?.apiKey
                ? `시스템 설정의 Gemini API (${geminiConfig.model})를 사용하여 정교한 청킹 및 FAQ 생성을 수행합니다.`
                : "기본적인 PDF 처리 방식으로 텍스트 추출과 FAQ를 생성합니다."}
            </p>
            <div className="mt-2 text-xs text-gray-500">
              {geminiConfig?.isActive && geminiConfig?.apiKey ? (
                <>
                  • Gemini AI 기반 문서 구조 분석
                  <br />
                  • 의미적 스마트 청킹
                  <br />
                  • 고품질 FAQ 자동 생성
                  <br />• 카테고리별 우선순위 정렬
                </>
              ) : (
                <>
                  • 기본 텍스트 추출
                  <br />
                  • 단순 청킹
                  <br />
                  • 기본 FAQ 생성
                  <br />
                  <span className="text-amber-600">
                    ※ 시스템 설정에서 Gemini API를 활성화하면 AI 강화 기능 사용
                    가능
                  </span>
                </>
              )}
            </div>

            {/* FAQ Count Setting - Only show when AI is enabled */}
            {geminiConfig?.isActive && geminiConfig?.apiKey && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                  FAQ 생성 개수 설정
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={faqCount}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (value >= 1 && value <= 20) {
                        setFaqCount(value);
                        localStorage.setItem(
                          "pdf-upload-faq-count",
                          value.toString(),
                        );
                      }
                    }}
                    className="w-20 px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center"
                  />
                  <span className="text-sm text-blue-700">개 (1-20개)</span>
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  문서 내용 분석 후 생성할 FAQ의 개수를 설정합니다. 권장: 5-10개
                </p>
              </div>
            )}
          </div>

          {/* File Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ${
              isDragOver
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <svg
              className="w-12 h-12 text-gray-400 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-lg font-medium text-gray-600 mb-2">
              PDF 파일 또는 이미지를 드래그하여 놓거나 클릭하여 선택하세요
            </p>
            <p className="text-sm text-gray-500 mb-4">
              여러 개의 PDF 파일 및 이미지를 동시에 업로드할 수 있습니다 (JPG,
              PNG, GIF, WEBP 지원)
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              파일 선택
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Selected Files */}
          {selectedFiles.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-black">
                선택된 파일 ({selectedFiles.length}개)
              </h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {selectedFiles.map((file, index) => {
                  const previewURL = getFilePreviewURL(file);
                  const isImage = isImageFile(file);
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-gray-50 p-3 rounded-lg"
                    >
                      <div className="flex items-center">
                        {isImage && previewURL ? (
                          <div className="w-12 h-12 rounded-lg overflow-hidden mr-3 border border-gray-200">
                            <img
                              src={previewURL}
                              alt={file.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mr-3">
                            <svg
                              className="w-6 h-6 text-red-600"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-black">{file.name}</p>
                          <p className="text-sm text-gray-500">
                            {formatFileSize(file.size)}
                            {isImage && (
                              <span className="ml-2 text-blue-600 text-xs">
                                이미지
                              </span>
                            )}
                            {!isImage && (
                              <span className="ml-2 text-red-600 text-xs">
                                PDF
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        disabled={isUploading}
                        className="text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploadProgress.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-black">업로드 진행 상황</h4>
              {uploadProgress.map((progress) => (
                <div
                  key={progress.documentId}
                  className="bg-white border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">
                      {progress.fileName}
                    </span>
                    <span className="text-sm text-gray-500">
                      {progress.progress}% - {getStageText(progress.stage)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        progress.stage === "error"
                          ? "bg-red-500"
                          : progress.stage === "completed"
                            ? "bg-green-500"
                            : "bg-blue-500"
                      }`}
                      style={{ width: `${progress.progress}%` }}
                    ></div>
                  </div>
                  {progress.error && (
                    <p className="text-sm text-red-600 mt-1">
                      {progress.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedFiles.length > 0 && (
                <>
                  {`${selectedFiles.length}개 파일 선택됨`}
                  {geminiConfig?.isActive && geminiConfig?.apiKey ? (
                    <span className="ml-2 text-blue-600 font-medium">
                      (Gemini AI 모드)
                    </span>
                  ) : (
                    <span className="ml-2 text-gray-500">(기본 모드)</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={isUploading}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || isUploading}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? "업로드 중..." : "업로드 시작"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PDFUploadModal;
