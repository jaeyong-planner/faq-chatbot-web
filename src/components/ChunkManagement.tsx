import React, { useState, useEffect, useMemo } from "react";
import { PDFDocument, PDFChunk } from "../types";
import { getSupabaseDatabaseService } from "../services/supabase";
import { useToast } from "./Toast";
import { createLogger } from "../services/logger";

const log = createLogger("ChunkMgmt");
interface ChunkWithDocument extends PDFChunk {
  sourceDocument?: PDFDocument;
}

const ChunkManagement: React.FC = () => {
  const { showToast } = useToast();
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(
    null,
  );
  const [chunks, setChunks] = useState<ChunkWithDocument[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<PDFChunk | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const dbService = useMemo(() => getSupabaseDatabaseService(), []);

  // Load all documents on mount
  useEffect(() => {
    loadDocuments();
  }, []);

  // Load chunks when document is selected
  useEffect(() => {
    if (selectedDocumentId) {
      loadChunks(selectedDocumentId);
    }
  }, [selectedDocumentId]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const allDocs = await dbService.getAllDocuments();
      // Only show completed documents
      const completedDocs = allDocs.filter((doc) => doc.status === "completed");
      setDocuments(completedDocs);
    } catch (error) {
      log.error("문서 로드 실패:", error);
      showToast("문서를 불러오는데 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  };

  const loadChunks = async (documentId: number) => {
    try {
      setLoading(true);
      const documentChunks = await dbService.getChunksByDocumentId(documentId);
      const selectedDoc = documents.find((doc) => doc.id === documentId);

      // Add source document info to each chunk
      const chunksWithDoc = documentChunks.map((chunk) => ({
        ...chunk,
        sourceDocument: selectedDoc,
      }));

      setChunks(chunksWithDoc);
    } catch (error) {
      log.error("청크 로드 실패:", error);
      showToast("청크를 불러오는데 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  };

  const filteredChunks = chunks.filter((chunk) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      chunk.content.toLowerCase().includes(searchLower) ||
      chunk.metadata?.title?.toLowerCase().includes(searchLower) ||
      chunk.metadata?.summary?.toLowerCase().includes(searchLower) ||
      chunk.metadata?.keywords?.some((kw) =>
        kw.toLowerCase().includes(searchLower),
      )
    );
  });

  const selectedDocument = documents.find(
    (doc) => doc.id === selectedDocumentId,
  );

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">청킹 관리</h1>
            <p className="text-sm text-gray-600 mt-1">
              문서별 청크와 OCR 원문을 확인하고 관리합니다
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              총{" "}
              <span className="font-semibold text-blue-600">
                {documents.length}
              </span>
              개 문서
            </div>
            {selectedDocumentId && (
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-green-600">
                  {chunks.length}
                </span>
                개 청크
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Document List */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              문서 목록
            </h2>
            <input
              type="text"
              placeholder="문서 검색..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && !selectedDocumentId ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : documents.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-sm">문서가 없습니다</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocumentId(doc.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      selectedDocumentId === doc.id
                        ? "bg-blue-50 border-l-4 border-blue-600"
                        : ""
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <svg
                        className="w-5 h-5 text-gray-600 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {doc.name}
                        </p>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-gray-500">
                            {doc.uploadDate}
                          </span>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-xs text-gray-500">
                            {doc.size}
                          </span>
                        </div>
                        {doc.metadata?.pages && (
                          <span className="text-xs text-blue-600 mt-1 inline-block">
                            {doc.metadata.pages}페이지
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle Panel - Chunk List */}
        {selectedDocumentId && (
          <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                청크 목록
              </h2>
              {selectedDocument && (
                <p className="text-sm text-gray-600 truncate">
                  {selectedDocument.name}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : filteredChunks.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p className="text-sm">청크가 없습니다</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredChunks.map((chunk) => (
                    <button
                      key={chunk.id}
                      onClick={() => setSelectedChunk(chunk)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                        selectedChunk?.id === chunk.id
                          ? "bg-blue-50 border-l-4 border-blue-600"
                          : ""
                      }`}
                    >
                      <div className="space-y-2">
                        {chunk.metadata?.title && (
                          <p className="text-sm font-medium text-gray-900 line-clamp-2">
                            {chunk.metadata.title}
                          </p>
                        )}
                        <p className="text-xs text-gray-600 line-clamp-3">
                          {chunk.content}
                        </p>
                        <div className="flex items-center space-x-2 text-xs text-gray-500">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100">
                            청크 #{chunk.chunkIndex + 1}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            {chunk.metadata?.pageLabel ||
                              `${chunk.pageNumber}페이지`}
                          </span>
                          {chunk.metadata?.importance && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded ${
                                chunk.metadata.importance === "high"
                                  ? "bg-red-100 text-red-700"
                                  : chunk.metadata.importance === "medium"
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {chunk.metadata.importance === "high"
                                ? "높음"
                                : chunk.metadata.importance === "medium"
                                  ? "보통"
                                  : "낮음"}
                            </span>
                          )}
                        </div>
                        {chunk.metadata?.keywords &&
                          chunk.metadata.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {chunk.metadata.keywords
                                .slice(0, 3)
                                .map((keyword, idx) => (
                                  <span
                                    key={idx}
                                    className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded"
                                  >
                                    {keyword}
                                  </span>
                                ))}
                            </div>
                          )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Chunk Detail (OCR Full Text) */}
        <div className="flex-1 bg-white flex flex-col">
          {selectedChunk ? (
            <>
              <div className="p-6 border-b border-gray-200 bg-gray-50">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                      {selectedChunk.metadata?.title ||
                        `청크 #${selectedChunk.chunkIndex + 1}`}
                    </h2>
                    <div className="flex items-center space-x-3 text-sm text-gray-600">
                      <span className="inline-flex items-center">
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
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        {selectedChunk.metadata?.pageLabel ||
                          `${selectedChunk.pageNumber}페이지`}
                      </span>
                      <span>•</span>
                      <span>청크 #{selectedChunk.chunkIndex + 1}</span>
                      <span>•</span>
                      <span>{selectedChunk.content.length}자</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedChunk(null)}
                    className="text-gray-400 hover:text-gray-600"
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

                {/* Metadata */}
                {selectedChunk.metadata && (
                  <div className="grid grid-cols-2 gap-4">
                    {selectedChunk.metadata.summary && (
                      <div className="col-span-2">
                        <p className="text-xs font-semibold text-gray-700 mb-1">
                          요약
                        </p>
                        <p className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200">
                          {selectedChunk.metadata.summary}
                        </p>
                      </div>
                    )}
                    {selectedChunk.metadata.importance && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">
                          중요도
                        </p>
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                            selectedChunk.metadata.importance === "high"
                              ? "bg-red-100 text-red-700"
                              : selectedChunk.metadata.importance === "medium"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {selectedChunk.metadata.importance === "high"
                            ? "높음"
                            : selectedChunk.metadata.importance === "medium"
                              ? "보통"
                              : "낮음"}
                        </span>
                      </div>
                    )}
                    {selectedChunk.metadata.chunkType && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">
                          청크 유형
                        </p>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                          {selectedChunk.metadata.chunkType}
                        </span>
                      </div>
                    )}
                    {selectedChunk.metadata.keywords &&
                      selectedChunk.metadata.keywords.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs font-semibold text-gray-700 mb-2">
                            핵심 키워드
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedChunk.metadata.keywords.map(
                              (keyword, idx) => (
                                <span
                                  key={idx}
                                  className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                                >
                                  {keyword}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    {selectedChunk.metadata.semanticKeywords &&
                      selectedChunk.metadata.semanticKeywords.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs font-semibold text-gray-700 mb-2">
                            의미적 키워드
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedChunk.metadata.semanticKeywords.map(
                              (keyword, idx) => (
                                <span
                                  key={idx}
                                  className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm"
                                >
                                  {keyword}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>

              {/* OCR Full Text */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    OCR 원문
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedChunk.content);
                      showToast(
                        "텍스트가 클립보드에 복사되었습니다.",
                        "success",
                      );
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors flex items-center space-x-1"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    <span>복사</span>
                  </button>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                  <p className="text-gray-800 whitespace-pre-wrap leading-relaxed font-mono text-sm">
                    {selectedChunk.content}
                  </p>
                </div>

                {/* Context Information */}
                {(selectedChunk.metadata?.contextBefore ||
                  selectedChunk.metadata?.contextAfter) && (
                  <div className="mt-6 space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      문맥 정보
                    </h3>
                    {selectedChunk.metadata.contextBefore && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-xs font-semibold text-blue-900 mb-2">
                          이전 문맥
                        </p>
                        <p className="text-sm text-blue-800">
                          {selectedChunk.metadata.contextBefore}
                        </p>
                      </div>
                    )}
                    {selectedChunk.metadata.contextAfter && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <p className="text-xs font-semibold text-green-900 mb-2">
                          다음 문맥
                        </p>
                        <p className="text-sm text-green-800">
                          {selectedChunk.metadata.contextAfter}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : selectedDocumentId ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <svg
                  className="mx-auto h-16 w-16 text-gray-400 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-lg font-medium">청크를 선택하세요</p>
                <p className="text-sm text-gray-400 mt-1">
                  왼쪽 목록에서 청크를 클릭하면 OCR 원문을 확인할 수 있습니다
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <svg
                  className="mx-auto h-16 w-16 text-gray-400 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-lg font-medium">문서를 선택하세요</p>
                <p className="text-sm text-gray-400 mt-1">
                  왼쪽 목록에서 문서를 선택하면 청크 목록을 확인할 수 있습니다
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChunkManagement;
