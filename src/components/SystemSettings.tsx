import React, { useState, useEffect, useCallback } from "react";
import { WebGeminiService } from "../services/WebGeminiService";
import { embeddingService } from "../services/embeddingService";
import { GeminiAPIConfig, CustomerServiceInfo } from "../types";
import { defaultConfig } from "../services/config";
import { useToast } from "./Toast";
import { createLogger } from "../services/logger";
import { getSupabaseDatabaseService } from "../services/supabase";
import { supabase } from "../services/supabase/client";

const log = createLogger("SysSettings");
const SystemSettings: React.FC = () => {
  const { showToast } = useToast();
  const dbService = getSupabaseDatabaseService();

  // 모델은 config.ts에서 중앙 관리 (새 모델 출시 시 config.ts만 업데이트)
  const [geminiSettings, setGeminiSettings] = useState<GeminiAPIConfig>({
    apiKey: "",
    isActive: false,
    model: defaultConfig.aiModel.geminiDefaultModel,
    baseUrl: defaultConfig.aiModel.geminiBaseUrl,
  });

  const [connectionStatus, setConnectionStatus] = useState<{
    status: "idle" | "testing" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const [showApiKey, setShowApiKey] = useState(false);

  // 고객센터 정보 설정
  const [customerServiceInfo, setCustomerServiceInfo] =
    useState<CustomerServiceInfo>({
      phone: "1234-5678",
      email: "support@embrain.com",
      operatingHours: "평일 09:00~18:00",
    });

  // 임베딩 관리 상태
  const [embeddingStats, setEmbeddingStats] = useState<{
    totalFaqs: number;
    withEmbedding: number;
    withoutEmbedding: number;
  }>({ totalFaqs: 0, withEmbedding: 0, withoutEmbedding: 0 });
  const [embeddingGenerating, setEmbeddingGenerating] = useState(false);
  const [embeddingResult, setEmbeddingResult] = useState<string>("");

  // RPC 함수 상태
  const [rpcStatus, setRpcStatus] = useState<{
    checking: boolean;
    existing: string[];
    missing: string[];
    message: string;
    sqlUrl?: string;
  }>({ checking: false, existing: [], missing: [], message: "" });

  // 임베딩 통계 로드
  const loadEmbeddingStats = useCallback(async () => {
    try {
      const { count: total } = await supabase
        .from("faqs")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

      const { count: withEmb } = await supabase
        .from("faqs")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true)
        .not("question_embedding", "is", null);

      const totalCount = total || 0;
      const withCount = withEmb || 0;

      setEmbeddingStats({
        totalFaqs: totalCount,
        withEmbedding: withCount,
        withoutEmbedding: totalCount - withCount,
      });
    } catch (error) {
      log.error("임베딩 통계 로드 실패:", error);
    }
  }, []);

  // RPC 함수 상태 확인
  const checkRpcStatus = useCallback(async () => {
    setRpcStatus((prev) => ({ ...prev, checking: true }));
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("/api/admin/setup-rpc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setRpcStatus({
          checking: false,
          existing: result.existing || [],
          missing: result.missing || [],
          message: result.message || "",
          sqlUrl: result.sql,
        });
      }
    } catch (error) {
      log.error("RPC 상태 확인 실패:", error);
      setRpcStatus((prev) => ({
        ...prev,
        checking: false,
        message: "확인 실패",
      }));
    }
  }, []);

  // 배치 임베딩 생성 (클라이언트 사이드 - Vercel timeout 회피)
  const handleGenerateEmbeddings = async () => {
    setEmbeddingGenerating(true);
    setEmbeddingResult("");

    try {
      const webGeminiService = WebGeminiService.getInstance();

      const allFaqs = await dbService.getAllFAQs();
      const faqsNeedingEmbedding = allFaqs.filter(
        (f) =>
          f.isActive &&
          (!f.questionEmbedding || f.questionEmbedding.length === 0),
      );

      if (faqsNeedingEmbedding.length === 0) {
        setEmbeddingResult("모든 FAQ에 이미 임베딩이 생성되어 있습니다.");
        setEmbeddingGenerating(false);
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const faq of faqsNeedingEmbedding) {
        try {
          setEmbeddingResult(
            `임베딩 생성 중... (${successCount + failCount + 1}/${faqsNeedingEmbedding.length})`,
          );

          const [questionEmbedding, answerEmbedding] =
            await webGeminiService.generateBatchEmbeddings([
              faq.question,
              faq.answer,
            ]);

          if (questionEmbedding?.length > 0 && answerEmbedding?.length > 0) {
            await dbService.updateFAQ(faq.id, {
              ...faq,
              questionEmbedding,
              answerEmbedding,
            });
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          log.error(`FAQ ${faq.id} 임베딩 생성 실패:`, error);
          failCount++;
        }
      }

      const msg = `임베딩 생성 완료: ${successCount}건 성공${failCount > 0 ? `, ${failCount}건 실패` : ""}`;
      setEmbeddingResult(msg);
      showToast(msg, failCount > 0 ? "warning" : "success");
      await loadEmbeddingStats();
    } catch (error: any) {
      const msg = error.message || "임베딩 생성 중 오류 발생";
      setEmbeddingResult(`오류: ${msg}`);
      showToast(msg, "error");
    } finally {
      setEmbeddingGenerating(false);
    }
  };

  // 설정 로드
  useEffect(() => {
    const loadSettings = async () => {
      // 고객센터 정보 로드 (localStorage 우선)
      try {
        const savedCS = localStorage.getItem("customer-service-info");
        if (savedCS) {
          setCustomerServiceInfo(JSON.parse(savedCS));
        }
      } catch {
        /* ignore */
      }

      // Gemini 설정 로드
      try {
        const saved = localStorage.getItem("system-gemini-config");
        const savedStatus = localStorage.getItem("gemini-connection-status");

        if (saved) {
          const parsed = JSON.parse(saved);
          const config: GeminiAPIConfig = {
            apiKey: parsed.apiKey || "",
            isActive: parsed.isActive || false,
            model: defaultConfig.aiModel.geminiDefaultModel,
            baseUrl: defaultConfig.aiModel.geminiBaseUrl,
          };
          setGeminiSettings(config);
          WebGeminiService.getInstance().setConfig(config);
          embeddingService.setGeminiConfig(config);

          if (savedStatus) {
            try {
              const ps = JSON.parse(savedStatus);
              const hours =
                (Date.now() - new Date(ps.testedAt).getTime()) / 3600000;
              if (hours < 24 && ps.status === "success") {
                setConnectionStatus({
                  status: "success",
                  message: ps.message + " (이전 연결 상태)",
                });
              }
            } catch {
              /* ignore */
            }
          }
        } else {
          const config = WebGeminiService.getInstance().getConfig();
          setGeminiSettings(config);
          embeddingService.setGeminiConfig(config);
        }
      } catch (error) {
        log.error("설정 로드 실패:", error);
        const config = WebGeminiService.getInstance().getConfig();
        setGeminiSettings(config);
        embeddingService.setGeminiConfig(config);
      }
    };

    loadSettings();
    loadEmbeddingStats();
    checkRpcStatus();
  }, [loadEmbeddingStats, checkRpcStatus]);

  // 연결 테스트
  const handleTest = async () => {
    if (!geminiSettings.apiKey) {
      setConnectionStatus({
        status: "error",
        message: "API 키를 먼저 입력해주세요.",
      });
      return;
    }

    setConnectionStatus({
      status: "testing",
      message: "연결을 테스트 중입니다...",
    });

    try {
      const config = { ...geminiSettings, isActive: true };
      WebGeminiService.getInstance().setConfig(config);
      embeddingService.setGeminiConfig(config);

      const result = await WebGeminiService.getInstance().testConnection();

      if (result.success) {
        setGeminiSettings((prev) => ({ ...prev, isActive: true }));
        setConnectionStatus({
          status: "success",
          message: "Gemini API 연결 성공",
        });

        // 자동 저장
        const saveConfig = { ...geminiSettings, isActive: true };
        localStorage.setItem(
          "system-gemini-config",
          JSON.stringify(saveConfig),
        );
        localStorage.setItem(
          "gemini-connection-status",
          JSON.stringify({
            status: "success",
            message: "Gemini API 연결 성공",
            testedAt: new Date().toISOString(),
          }),
        );

        // Supabase에도 저장
        try {
          await dbService.setSetting("gemini_api_key", geminiSettings.apiKey);
        } catch (error) {
          log.warn("Supabase 설정 저장 실패:", error);
        }

        showToast(
          "Gemini API 연결 성공! 설정이 자동 저장되었습니다.",
          "success",
        );
      } else {
        setConnectionStatus({ status: "error", message: result.message });
      }
    } catch (error) {
      setConnectionStatus({
        status: "error",
        message: "연결 테스트 중 오류가 발생했습니다.",
      });
    }
  };

  // 설정 저장
  const handleSave = async () => {
    try {
      localStorage.setItem(
        "system-gemini-config",
        JSON.stringify(geminiSettings),
      );
      WebGeminiService.getInstance().setConfig(geminiSettings);
      embeddingService.setGeminiConfig(geminiSettings);

      // Supabase에도 저장
      if (geminiSettings.apiKey) {
        try {
          await dbService.setSetting("gemini_api_key", geminiSettings.apiKey);
        } catch (error) {
          log.warn("Supabase 설정 저장 실패:", error);
        }
      }

      showToast("설정이 저장되었습니다.", "success");
    } catch (error) {
      showToast("설정 저장에 실패했습니다.", "error");
    }
  };

  // 고객센터 정보 저장
  const handleSaveCustomerService = async () => {
    try {
      localStorage.setItem(
        "customer-service-info",
        JSON.stringify(customerServiceInfo),
      );
      showToast("고객센터 정보가 저장되었습니다.", "success");
    } catch {
      showToast("고객센터 정보 저장에 실패했습니다.", "error");
    }
  };

  // 설정 삭제
  const handleDelete = () => {
    const resetConfig: GeminiAPIConfig = {
      apiKey: "",
      isActive: false,
      model: defaultConfig.aiModel.geminiDefaultModel,
      baseUrl: defaultConfig.aiModel.geminiBaseUrl,
    };

    setGeminiSettings(resetConfig);
    setConnectionStatus({ status: "idle", message: "" });
    WebGeminiService.getInstance().setConfig(resetConfig);
    embeddingService.setGeminiConfig(resetConfig);

    try {
      localStorage.removeItem("system-gemini-config");
      localStorage.removeItem("gemini-connection-status");
      showToast("설정이 삭제되었습니다.", "success");
    } catch {
      showToast("설정 삭제 중 오류가 발생했습니다.", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-black">시스템 설정</h1>
        <p className="text-gray-600 mt-1">
          Gemini API 키를 등록하면 모든 기능이 활성화됩니다
        </p>
      </div>

      {/* Gemini API Key */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-black mb-6 flex items-center">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
            <svg
              className="w-5 h-5 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          Gemini API 키
        </h3>

        {/* API Key Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-600 mb-2">
            API 키
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              value={geminiSettings.apiKey}
              onChange={(e) =>
                setGeminiSettings((prev) => ({
                  ...prev,
                  apiKey: e.target.value,
                }))
              }
              placeholder="AIza..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {showApiKey ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                ) : (
                  <>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </>
                )}
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Google AI Studio
            </a>
            에서 API 키를 발급받으세요. 이 키로 임베딩, 문서 분석, FAQ 생성 등
            모든 기능이 작동합니다.
          </p>
        </div>

        {/* Connection Status */}
        {connectionStatus.status !== "idle" && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-center ${
              connectionStatus.status === "success"
                ? "bg-green-50 border border-green-200 text-green-700"
                : connectionStatus.status === "error"
                  ? "bg-red-50 border border-red-200 text-red-700"
                  : "bg-blue-50 border border-blue-200 text-blue-700"
            }`}
          >
            {connectionStatus.status === "testing" && (
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            )}
            {connectionStatus.status === "success" && (
              <svg
                className="w-5 h-5 mr-2 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {connectionStatus.status === "error" && (
              <svg
                className="w-5 h-5 mr-2 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            <span className="text-sm">{connectionStatus.message}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleTest}
            disabled={
              connectionStatus.status === "testing" || !geminiSettings.apiKey
            }
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200 font-medium"
          >
            {connectionStatus.status === "testing"
              ? "테스트 중..."
              : "연결 테스트"}
          </button>
          <button
            onClick={handleSave}
            className="bg-gray-600 text-white px-5 py-2.5 rounded-lg hover:bg-gray-700 transition-colors duration-200 font-medium"
          >
            설정 저장
          </button>
          <button
            onClick={handleDelete}
            className="text-red-600 px-5 py-2.5 rounded-lg hover:bg-red-50 transition-colors duration-200 font-medium"
          >
            초기화
          </button>
        </div>
      </div>

      {/* Customer Service Info */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-black mb-6 flex items-center">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mr-3">
            <svg
              className="w-5 h-5 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
          </div>
          고객센터 정보 설정
        </h3>

        <p className="text-sm text-gray-500 mb-4">
          챗봇이 답변을 찾지 못할 때 안내할 고객센터 연락처를 설정합니다.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">
              전화번호
            </label>
            <input
              type="text"
              value={customerServiceInfo.phone}
              onChange={(e) =>
                setCustomerServiceInfo((prev) => ({
                  ...prev,
                  phone: e.target.value,
                }))
              }
              placeholder="1234-5678"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">
              이메일
            </label>
            <input
              type="email"
              value={customerServiceInfo.email}
              onChange={(e) =>
                setCustomerServiceInfo((prev) => ({
                  ...prev,
                  email: e.target.value,
                }))
              }
              placeholder="support@embrain.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">
              운영 시간
            </label>
            <input
              type="text"
              value={customerServiceInfo.operatingHours}
              onChange={(e) =>
                setCustomerServiceInfo((prev) => ({
                  ...prev,
                  operatingHours: e.target.value,
                }))
              }
              placeholder="평일 09:00~18:00"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSaveCustomerService}
            className="bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors duration-200 font-medium"
          >
            고객센터 정보 저장
          </button>
        </div>
      </div>

      {/* Embedding Management */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-black mb-6 flex items-center">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
            <svg
              className="w-5 h-5 text-purple-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          FAQ 임베딩 관리
        </h3>

        <p className="text-sm text-gray-500 mb-4">
          임베딩은 FAQ의 의미를 벡터로 변환하여 사용자 질문과 유사한 FAQ를 찾는
          데 사용됩니다. 임베딩이 없으면 키워드 매칭만 사용되어 검색 정확도가
          낮아집니다.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">
              {embeddingStats.totalFaqs}
            </p>
            <p className="text-xs text-gray-500 mt-1">전체 FAQ</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {embeddingStats.withEmbedding}
            </p>
            <p className="text-xs text-gray-500 mt-1">임베딩 완료</p>
          </div>
          <div
            className={`rounded-lg p-4 text-center ${embeddingStats.withoutEmbedding > 0 ? "bg-red-50" : "bg-gray-50"}`}
          >
            <p
              className={`text-2xl font-bold ${embeddingStats.withoutEmbedding > 0 ? "text-red-600" : "text-gray-400"}`}
            >
              {embeddingStats.withoutEmbedding}
            </p>
            <p className="text-xs text-gray-500 mt-1">임베딩 미생성</p>
          </div>
        </div>

        {/* Progress bar */}
        {embeddingStats.totalFaqs > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>임베딩 진행률</span>
              <span>
                {Math.round(
                  (embeddingStats.withEmbedding / embeddingStats.totalFaqs) *
                    100,
                )}
                %
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(embeddingStats.withEmbedding / embeddingStats.totalFaqs) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Result message */}
        {embeddingResult && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${
              embeddingResult.startsWith("오류")
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {embeddingResult}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleGenerateEmbeddings}
            disabled={
              embeddingGenerating || embeddingStats.withoutEmbedding === 0
            }
            className="bg-purple-600 text-white px-5 py-2.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors duration-200 font-medium flex items-center"
          >
            {embeddingGenerating ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                임베딩 생성 중...
              </>
            ) : (
              "임베딩 생성"
            )}
          </button>
          <button
            onClick={loadEmbeddingStats}
            className="text-gray-600 px-5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors duration-200 font-medium"
          >
            새로고침
          </button>
        </div>

        {embeddingStats.withoutEmbedding === 0 &&
          embeddingStats.totalFaqs > 0 && (
            <p className="mt-3 text-sm text-green-600">
              모든 FAQ에 임베딩이 생성되어 있습니다.
            </p>
          )}
      </div>

      {/* RPC Function Status */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-black mb-6 flex items-center">
          <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mr-3">
            <svg
              className="w-5 h-5 text-orange-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
              />
            </svg>
          </div>
          데이터베이스 검색 함수 상태
        </h3>

        <p className="text-sm text-gray-500 mb-4">
          벡터 검색에 필요한 PostgreSQL RPC 함수 상태를 확인합니다. 함수가
          없으면 클라이언트 사이드 검색으로 자동 전환되지만, 성능이 저하될 수
          있습니다.
        </p>

        {rpcStatus.checking ? (
          <div className="flex items-center text-sm text-gray-500">
            <svg
              className="animate-spin mr-2 h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            RPC 함수 상태 확인 중...
          </div>
        ) : (
          <>
            {rpcStatus.message && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${
                  rpcStatus.missing.length === 0
                    ? "bg-green-50 text-green-700"
                    : "bg-yellow-50 text-yellow-700"
                }`}
              >
                {rpcStatus.message}
              </div>
            )}

            {rpcStatus.existing.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">
                  준비 완료:
                </p>
                <div className="flex flex-wrap gap-1">
                  {rpcStatus.existing.map((fn) => (
                    <span
                      key={fn}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700"
                    >
                      {fn}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rpcStatus.missing.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-1">누락:</p>
                <div className="flex flex-wrap gap-1">
                  {rpcStatus.missing.map((fn) => (
                    <span
                      key={fn}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700"
                    >
                      {fn}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center space-x-3">
              <button
                onClick={checkRpcStatus}
                className="text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors duration-200 text-sm font-medium"
              >
                다시 확인
              </button>
              {rpcStatus.sqlUrl && (
                <a
                  href={rpcStatus.sqlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-600 px-4 py-2 rounded-lg hover:bg-orange-50 transition-colors duration-200 text-sm font-medium"
                >
                  Supabase SQL Editor 열기
                </a>
              )}
            </div>
          </>
        )}
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 rounded-xl p-5 border border-blue-100">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">
          API 키 하나로 모든 기능이 작동합니다
        </h4>
        <ul className="text-xs text-blue-700 space-y-1">
          <li>- PDF 문서 텍스트 추출 및 분석</li>
          <li>- FAQ 질문/답변 자동 생성</li>
          <li>- 텍스트 임베딩 (벡터 검색용)</li>
          <li>- 의도 기반 FAQ 매칭 및 답변</li>
        </ul>
      </div>
    </div>
  );
};

export default SystemSettings;
