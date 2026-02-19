
export interface FAQ {
  id: number;
  question: string;
  answer: string;
  category: string;
  isActive: boolean;
  isFeatured?: boolean;
  featuredAt?: string;
  imageUrl?: string;
  linkUrl?: string;
  attachment?: File;
  attachmentUrl?: string;
  attachmentName?: string;
  documentId?: number;
  sourceDocument?: PDFDocument;
  questionEmbedding?: number[];
  answerEmbedding?: number[];
  sourceChunkIds?: number[];
  pageReferences?: number[];
  documentLink?: string;
  semanticKeywords?: string[];
  relatedTopics?: string[];
  confidence?: number;
  generationSource?: 'semantic_analysis' | 'manual' | 'template';
}

export interface Category {
  id: number;
  name: string;
}

export interface ChatLog {
  id: number;
  timestamp: string;
  user: string;
  query: string;
  response: string;
  isFlagged: boolean;
}

export type ChatSessionStatus = 'completed' | 'ongoing' | 'abandoned';

export interface ChatSession {
  id: number;
  sessionId: string;
  user?: string;
  userEmail?: string;
  startTime: string;
  endTime?: string;
  status: ChatSessionStatus;
  satisfaction?: number;
  category?: string;
  isResolved: boolean;
  tags: string[];
  messageCount: number;
  duration?: string;
}

export interface ChatSessionCreateInput {
  sessionId: string;
  user?: string;
  userEmail?: string;
  startTime: string;
  status?: ChatSessionStatus;
  satisfaction?: number;
  category?: string;
  isResolved?: boolean;
  tags?: string[];
  messageCount?: number;
  duration?: string;
}

export interface ChatSessionUpdateInput {
  endTime?: string;
  status?: ChatSessionStatus;
  satisfaction?: number;
  category?: string;
  isResolved?: boolean;
  tags?: string[];
  messageCount?: number;
  duration?: string;
  user?: string;
  userEmail?: string;
}

export type ChatMessageSender = 'user' | 'bot';

export interface ChatLogMessage {
  id: number;
  sessionId: string;
  timestamp: string;
  sender: ChatMessageSender;
  message: string;
  messageType?: 'text' | 'file' | 'image';
  responseTime?: number;
  confidence?: number;
  sourceFaq?: number;
}

export interface ChatLogMessageCreateInput {
  sessionId: string;
  timestamp: string;
  sender: ChatMessageSender;
  message: string;
  messageType?: 'text' | 'file' | 'image';
  responseTime?: number;
  confidence?: number;
  sourceFaq?: number;
}

export interface SystemStats {
  totalFaqs: number;
  totalChats: number;
  activeUsers: number;
  systemHealth: number;
}

export interface APIConfig {
  id: string;
  name: string;
  apiKey: string;
  isActive: boolean;
}

export type Page = '대시보드' | '엠브레인Agent관리' | '문서 관리' | '청크 관리' | '채팅 로그' | '채팅 분석' | '시스템 설정';

export interface RagAnalysisResult {
    faithfulness: number;
    relevance: number;
    completeness: number;
    explanation: string;
}

export interface ChatMessage {
  id: number;
  text: string;
  sender: 'user' | 'bot';
  sourceFaq?: FAQ;
  feedback?: 'helpful' | 'unhelpful' | null;
}

export interface DocumentImage {
  id?: string;
  url: string;
  fileName: string;
  pageNumber?: number;
  description?: string;
  embeddings?: number[];
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    extractedText?: string;
  };
}

export interface DocumentGraph {
  id?: string;
  url: string;
  fileName: string;
  pageNumber?: number;
  title?: string;
  description?: string;
  type?: 'bar' | 'line' | 'pie' | 'scatter' | 'other';
  embeddings?: number[];
  metadata?: {
    width?: number;
    height?: number;
    dataPoints?: any[];
    axes?: {
      x?: string;
      y?: string;
    };
  };
}

export interface PDFDocument {
  id: number;
  name: string;
  size: string;
  uploadDate: string;
  status: 'processing' | 'completed' | 'error';
  uploadMode: string;
  filePath?: string;
  ocrText?: string;
  metadata?: {
    pages: number;
    textContent?: string;
    images?: DocumentImage[];
    graphs?: DocumentGraph[];
    tables?: any[];
    keywords?: string[];
    imageData?: any;
    analysis?: any;
  };
  chunks?: PDFChunk[];
  generatedFaqs?: FAQ[];
  nameEmbedding?: number[];
}

export interface PDFChunk {
  id: number;
  documentId: number;
  content: string;
  pageNumber: number;
  chunkIndex: number;
  embeddings?: number[];
  metadata?: {
    pageLabel?: string;
    pageRange?: string;
    title?: string;
    summary?: string;
    importance?: 'high' | 'medium' | 'low';
    keywords?: string[];
    semanticKeywords?: string[];
    chunkType?: 'paragraph' | 'section' | 'page' | 'heading' | 'content';
    type?: string;
    sectionName?: string;
    sectionIndex?: number;
    parentSection?: string;
    imageUrl?: string;
    isSemanticChunk?: boolean;
    paragraphIndex?: number;
    detectionMethod?: string;
    contextBefore?: string;
    contextAfter?: string;
  };
}

export interface GeminiAPIConfig {
  apiKey: string;
  isActive: boolean;
  model: string;
  baseUrl?: string;
}

export interface DocumentUploadProgress {
  documentId: number | string;
  fileName: string;
  progress: number;
  stage: 'uploading' | 'processing' | 'extracting' | 'chunking' | 'generating_faqs' | 'completed' | 'error';
  error?: string;
}

export interface RecentConversation {
  sessionId: string;
  userMessage: string;
  botResponse: string;
  timestamp: string;
  satisfaction?: number | null;
  confidence?: number | null;
}

export interface DashboardMetrics {
  totalFaqs: number;
  monthlyQuestions: number;
  responseRate: number;
  avgResponseTimeMs: number | null;
  lastActivity: string | null;
  satisfactionAverage: number | null;
  satisfactionCount: number;
  faqCategoryDistribution: Array<{
    category: string;
    count: number;
  }>;
  recentActivities: Array<{
    action: string;
    item: string;
    timestamp: string;
  }>;
  recentConversations: RecentConversation[];
}

export interface ChatAnalytics {
  hourlyDistribution: Array<{
    hour: string;
    count: number;
  }>;
  topQuestions: Array<{
    question: string;
    count: number;
    category?: string;
  }>;
  satisfactionAverage: number | null;
  resolutionRate: number | null;
  activeUsers: number;
}

export interface CustomerServiceInfo {
  phone: string;
  email: string;
  operatingHours: string;
}

export interface FallbackMessageConfig {
  title: string;
  body: string;
  showPhone: boolean;
  showEmail: boolean;
  showFaqGuide: boolean;
  additionalMessage: string;
}
