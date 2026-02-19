import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChatAnalytics } from "../types";
import { getSupabaseDatabaseService } from "../services/supabase";
import { exportAnalyticsToExcel } from "../services/excelExportService";
import { createLogger } from "../services/logger";

const log = createLogger("ChatLogAnalysis");
type Period = "today" | "week" | "month";

const PERIOD_OPTIONS: { key: Period; label: string; desc: string }[] = [
  { key: "today", label: "오늘", desc: "오늘" },
  { key: "week", label: "금주", desc: "최근 7일" },
  { key: "month", label: "금월", desc: "최근 30일" },
];

const EMPTY_ANALYTICS: ChatAnalytics = {
  hourlyDistribution: [],
  topQuestions: [],
  satisfactionAverage: 0,
  resolutionRate: 0,
  activeUsers: 0,
};

const ChatLogAnalysis: React.FC = () => {
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);
  const [period, setPeriod] = useState<Period>("month");
  const [analytics, setAnalytics] = useState<ChatAnalytics>(EMPTY_ANALYTICS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(
    async (p: Period) => {
      setIsLoading(true);
      try {
        const result = await dbService.getChatAnalytics(p);

        const hasData =
          result.hourlyDistribution.length > 0 ||
          result.topQuestions.length > 0 ||
          (result.satisfactionAverage !== null &&
            result.satisfactionAverage > 0) ||
          (result.activeUsers !== null && result.activeUsers > 0);

        if (hasData) {
          setAnalytics(result);
          setError(null);
        } else {
          setAnalytics(EMPTY_ANALYTICS);
          setError(null);
        }
      } catch (err) {
        log.error("채팅 로그 분석 데이터 로드 실패:", err);
        setError("채팅 로그 분석 데이터를 불러오지 못했습니다.");
        setAnalytics(EMPTY_ANALYTICS);
      } finally {
        setIsLoading(false);
      }
    },
    [dbService],
  );

  useEffect(() => {
    loadAnalytics(period);
  }, [period, loadAnalytics]);

  const handlePeriodChange = (p: Period) => {
    if (p !== period) setPeriod(p);
  };

  const hourlyData = analytics.hourlyDistribution;
  const topQuestions = analytics.topQuestions;
  const hasData = hourlyData.length > 0 || topQuestions.length > 0;

  const totalQuestions = useMemo(
    () => hourlyData.reduce((sum, item) => sum + item.count, 0),
    [hourlyData],
  );
  const periodLabel = PERIOD_OPTIONS.find((o) => o.key === period)?.desc ?? "";
  const avgQuestionsPerHour = useMemo(
    () =>
      hourlyData.length > 0
        ? (totalQuestions / hourlyData.length).toFixed(1)
        : "0",
    [hourlyData, totalQuestions],
  );
  const satisfactionDisplay =
    analytics.satisfactionAverage !== null && analytics.satisfactionAverage > 0
      ? analytics.satisfactionAverage.toFixed(1)
      : "-";
  const resolutionPercent =
    analytics.resolutionRate !== null && analytics.resolutionRate > 0
      ? `${(analytics.resolutionRate * 100).toFixed(1)}%`
      : "-";

  const maxCount = useMemo(
    () => Math.max(...topQuestions.map((q) => q.count), 1),
    [topQuestions],
  );

  return (
    <div className="space-y-6">
      {/* Header with Period Filter */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">채팅 로그 분석</h1>
            <p className="text-gray-600 mt-1">
              사용자 질문 패턴과 트렌드를 분석합니다
            </p>
            {error && <p className="text-sm text-amber-600 mt-2">{error}</p>}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => exportAnalyticsToExcel(analytics, periodLabel)}
              disabled={isLoading || !hasData}
              className="px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              <svg
                className="w-4 h-4 mr-1.5"
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
              리포트 다운로드
            </button>
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handlePeriodChange(opt.key)}
                  disabled={isLoading}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    period === opt.key
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  } ${isLoading ? "opacity-50 cursor-wait" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-600"
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
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">총 질문 수</p>
              <p className="text-2xl font-bold text-black">
                {isLoading ? "..." : totalQuestions.toLocaleString("ko-KR")}
              </p>
              <p className="text-xs text-gray-500">
                {periodLabel} · 시간당 평균 {avgQuestionsPerHour}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-green-600"
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
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">세션 해결률</p>
              <p className="text-2xl font-bold text-black">
                {isLoading ? "..." : resolutionPercent}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">평균 만족도</p>
              <p className="text-2xl font-bold text-black">
                {isLoading ? "..." : `${satisfactionDisplay}/5`}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">활성 사용자</p>
              <p className="text-2xl font-bold text-black">
                {isLoading
                  ? "..."
                  : analytics.activeUsers.toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm p-12">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500">데이터를 불러오는 중...</p>
          </div>
        </div>
      ) : !hasData ? (
        <div className="bg-white rounded-xl shadow-sm p-12">
          <div className="text-center">
            <svg
              className="w-16 h-16 text-gray-300 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-lg text-gray-500 mb-2">
              {periodLabel} 데이터가 없습니다
            </p>
            <p className="text-sm text-gray-400">
              채팅 대화가 시작되면 분석 데이터가 여기에 표시됩니다
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Hourly Distribution */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-black">
                시간대별 질문 분포
              </h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                {periodLabel}
              </span>
            </div>
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="hour"
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => `${v}시`}
                  />
                  <YAxis
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    }}
                    formatter={(value: number | undefined) => [
                      `${value ?? 0}건`,
                      "질문 수",
                    ]}
                    labelFormatter={(label: React.ReactNode) =>
                      `${String(label)}시`
                    }
                  />
                  <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <p>시간대별 데이터가 없습니다</p>
              </div>
            )}
          </div>

          {/* Top Questions */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-black">
                인기 질문 TOP 5
              </h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                {periodLabel}
              </span>
            </div>
            {topQuestions.length > 0 ? (
              <div className="space-y-3">
                {topQuestions.map((item, index) => {
                  const barWidth = Math.max((item.count / maxCount) * 100, 8);
                  return (
                    <div key={index} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center min-w-0 flex-1 mr-3">
                          <span
                            className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mr-2 ${
                              index === 0
                                ? "bg-yellow-100 text-yellow-700"
                                : index === 1
                                  ? "bg-gray-100 text-gray-600"
                                  : index === 2
                                    ? "bg-orange-100 text-orange-600"
                                    : "bg-gray-50 text-gray-400"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <p
                            className="text-sm text-gray-800 truncate"
                            title={item.question}
                          >
                            {item.question}
                          </p>
                        </div>
                        <span className="flex-shrink-0 text-sm font-semibold text-blue-600">
                          {item.count}회
                        </span>
                      </div>
                      <div className="ml-8 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-400 rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        {item.category && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            {item.category}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <p>인기 질문 데이터가 없습니다</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatLogAnalysis;
