import React, { useEffect, useMemo, useState } from "react";
import { DashboardMetrics } from "../types";
import { getSupabaseDatabaseService } from "../services/supabase";
// TODO: excelExportService 웹 버전 구현 필요
// import { exportDashboardToExcel } from '../services/excelExportService';

interface DashboardProps {
  onNavigateToChatLogs?: () => void;
  onGoToChatbot?: () => void;
}

const CATEGORY_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-indigo-500",
];

const DEFAULT_METRICS: DashboardMetrics = {
  totalFaqs: 0,
  monthlyQuestions: 0,
  responseRate: 0,
  avgResponseTimeMs: null,
  lastActivity: null,
  satisfactionAverage: null,
  satisfactionCount: 0,
  faqCategoryDistribution: [],
  recentActivities: [],
  recentConversations: [],
};

const Dashboard: React.FC<DashboardProps> = ({
  onNavigateToChatLogs,
  onGoToChatbot,
}) => {
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);

  const [metrics, setMetrics] = useState<DashboardMetrics>(DEFAULT_METRICS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const result = await dbService.getDashboardMetrics();
        setMetrics(result);
      } catch (err) {
        console.error("대시보드 지표 로드 실패:", err);
        setError("실시간 지표를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        setMetrics(DEFAULT_METRICS);
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();
  }, [dbService]);

  const stats = useMemo(() => {
    const responsePercent = `${(metrics.responseRate * 100).toFixed(1)}%`;
    const formattedAvgResponse = (() => {
      if (metrics.avgResponseTimeMs === null) return "데이터 없음";
      if (metrics.avgResponseTimeMs < 1000) {
        return `${Math.round(metrics.avgResponseTimeMs)}ms`;
      }
      const seconds = metrics.avgResponseTimeMs / 1000;
      return `${seconds.toFixed(1)}초`;
    })();

    return [
      {
        title: "총 FAQ 수",
        value: metrics.totalFaqs.toLocaleString("ko-KR"),
        subtitle: "활성 FAQ 기준",
      },
      {
        title: "이번 달 질문",
        value: metrics.monthlyQuestions.toLocaleString("ko-KR"),
        subtitle: "사용자 질문 건수",
      },
      {
        title: "응답률",
        value: responsePercent,
        subtitle: "해결된 세션 비율",
      },
      {
        title: "평균 응답 시간",
        value: formattedAvgResponse,
        subtitle: "AI 응답 평균",
      },
    ];
  }, [metrics]);

  const categories = useMemo(() => {
    const total = metrics.faqCategoryDistribution.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    if (total === 0) {
      return [{ name: "데이터 없음", value: 0, color: "bg-gray-300", raw: 0 }];
    }

    return metrics.faqCategoryDistribution.map((item, index) => ({
      name: item.category,
      value: Math.round((item.count / total) * 100),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      raw: item.count,
    }));
  }, [metrics.faqCategoryDistribution]);

  const recentConversations = useMemo(() => {
    return metrics.recentConversations.map((conv, idx) => {
      const timeDiff = (() => {
        const ts = new Date(conv.timestamp);
        if (Number.isNaN(ts.getTime())) return conv.timestamp;
        const diffMs = Date.now() - ts.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);
        if (diffMinutes < 1) return "방금 전";
        if (diffMinutes < 60) return `${diffMinutes}분 전`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}시간 전`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}일 전`;
      })();

      return { ...conv, id: idx, time: timeDiff };
    });
  }, [metrics.recentConversations]);

  const lastUpdatedText = useMemo(() => {
    if (!metrics.lastActivity) return "데이터 없음";
    const ts = new Date(metrics.lastActivity);
    if (Number.isNaN(ts.getTime())) {
      return metrics.lastActivity;
    }
    return ts.toLocaleString("ko-KR");
  }, [metrics.lastActivity]);

  const handleExportExcel = () => {
    // TODO: exportDashboardToExcel 구현 후 활성화
    alert("엑셀 내보내기 기능은 추후 구현 예정입니다.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">대시보드</h1>
            <p className="text-gray-600 mt-1">엠브레인Agent 관리 현황</p>
          </div>
          <div className="flex items-center space-x-4">
            {onGoToChatbot && (
              <button
                onClick={onGoToChatbot}
                className="flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors duration-200"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                채팅 테스트
              </button>
            )}
            <button
              onClick={handleExportExcel}
              disabled={isLoading}
              className="flex items-center px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              엑셀 내보내기
            </button>
            <div className="text-right">
              <p className="text-sm text-gray-500">마지막 업데이트</p>
              <p className="text-sm font-medium text-black">
                {isLoading ? "로딩 중..." : lastUpdatedText}
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <div
            key={index}
            className="card hover:shadow-md transition-shadow duration-200"
          >
            <div>
              <p className="text-sm font-medium text-gray-600">{stat.title}</p>
              <p className="text-2xl font-bold text-black mt-2">{stat.value}</p>
              <div className="flex items-center mt-2">
                <span className="text-sm text-gray-500">{stat.subtitle}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Category Distribution */}
      <div className="card">
        <h3 className="text-lg font-semibold text-black mb-4">
          카테고리별 질문 분포
        </h3>
        <div className="space-y-3">
          {categories.map((category, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center">
                <div
                  className={`w-3 h-3 rounded-full mr-3 ${category.color}`}
                ></div>
                <span className="text-sm font-medium text-gray-600">
                  {category.name}
                </span>
              </div>
              <div className="flex items-center">
                <div className="w-32 bg-gray-200 rounded-full h-2 mr-3">
                  <div
                    className={`h-2 rounded-full ${category.color}`}
                    style={{ width: `${category.value}%` }}
                  ></div>
                </div>
                <span className="text-sm text-gray-600 w-16 text-right">
                  {category.value}% ({category.raw})
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-black">최근 대화</h3>
          <button
            onClick={onNavigateToChatLogs}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors duration-200"
          >
            전체 보기
          </button>
        </div>
        {recentConversations.length === 0 ? (
          <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-6 text-center">
            최근 대화 내역이 아직 없어요.
          </div>
        ) : (
          <div className="space-y-4">
            {recentConversations.map((conv) => (
              <div
                key={conv.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors duration-200"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      사용자
                    </span>
                    {conv.confidence !== null &&
                      conv.confidence !== undefined && (
                        <span className="text-xs text-gray-400">
                          신뢰도 {(conv.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                  </div>
                  <span className="text-xs text-gray-500">{conv.time}</span>
                </div>
                <p className="text-sm text-black mb-3 line-clamp-2">
                  {conv.userMessage}
                </p>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      챗봇
                    </span>
                    {conv.satisfaction !== null &&
                      conv.satisfaction !== undefined && (
                        <div className="flex items-center">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <svg
                              key={star}
                              className={`w-3 h-3 ${star <= conv.satisfaction! ? "text-yellow-400" : "text-gray-300"}`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                      )}
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-3">
                    {conv.botResponse}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
