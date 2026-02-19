import React, { useState, useEffect, useMemo } from "react";
import { getSupabaseDatabaseService } from "../services/supabase";
import { useToast } from "./Toast";
import { createLogger } from "../services/logger";

const log = createLogger("DbSettings");
interface DatabaseSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChanged?: () => void;
}

const DatabaseSettings: React.FC<DatabaseSettingsProps> = ({
  isOpen,
  onClose,
  onSettingsChanged,
}) => {
  const { showToast } = useToast();
  const [stats, setStats] = useState({
    totalDocuments: 0,
    totalChunks: 0,
    totalFAQs: 0,
    completedDocuments: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "connected" | "error"
  >("checking");
  const dbService = useMemo(() => getSupabaseDatabaseService(), []);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setConnectionStatus("checking");

      // Check health
      const isHealthy = await dbService.healthCheck();
      setConnectionStatus(isHealthy ? "connected" : "error");

      // Get stats
      const dbStats = await dbService.getStats();
      setStats(dbStats);
    } catch (error) {
      log.error("Failed to load database settings:", error);
      setConnectionStatus("error");
      showToast("데이터베이스 설정을 불러오는데 실패했습니다.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshStats = async () => {
    try {
      setIsLoading(true);
      const dbStats = await dbService.getStats();
      setStats(dbStats);
      showToast("통계가 새로고침되었습니다.", "success");

      if (onSettingsChanged) {
        onSettingsChanged();
      }
    } catch (error) {
      log.error("Failed to refresh stats:", error);
      showToast("통계 새로고침에 실패했습니다.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-black">데이터베이스 설정</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
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

        {/* Connection Status */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-black mb-4">연결 상태</h3>
          <div
            className={`rounded-lg p-4 ${
              connectionStatus === "connected"
                ? "bg-green-50 border border-green-200"
                : connectionStatus === "error"
                  ? "bg-red-50 border border-red-200"
                  : "bg-yellow-50 border border-yellow-200"
            }`}
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                {connectionStatus === "connected" ? (
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
                ) : connectionStatus === "error" ? (
                  <svg
                    className="w-6 h-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-600"></div>
                )}
              </div>
              <div className="ml-3">
                <p
                  className={`text-sm font-medium ${
                    connectionStatus === "connected"
                      ? "text-green-800"
                      : connectionStatus === "error"
                        ? "text-red-800"
                        : "text-yellow-800"
                  }`}
                >
                  {connectionStatus === "connected"
                    ? "Supabase 연결됨"
                    : connectionStatus === "error"
                      ? "Supabase 연결 실패"
                      : "연결 확인 중..."}
                </p>
                <p
                  className={`text-xs mt-1 ${
                    connectionStatus === "connected"
                      ? "text-green-700"
                      : connectionStatus === "error"
                        ? "text-red-700"
                        : "text-yellow-700"
                  }`}
                >
                  {connectionStatus === "connected"
                    ? "데이터베이스가 정상적으로 작동하고 있습니다."
                    : connectionStatus === "error"
                      ? "데이터베이스 연결에 문제가 있습니다. 네트워크 및 환경 변수를 확인해주세요."
                      : "데이터베이스 상태를 확인하고 있습니다..."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Current Statistics */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-black">
              현재 데이터베이스 상태
            </h3>
            <button
              onClick={handleRefreshStats}
              disabled={isLoading}
              className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              {isLoading ? "새로고침 중..." : "새로고침"}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {stats.totalDocuments}
              </div>
              <div className="text-sm text-blue-800">총 문서</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {stats.completedDocuments}
              </div>
              <div className="text-sm text-green-800">처리 완료</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {stats.totalChunks}
              </div>
              <div className="text-sm text-purple-800">총 청크</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">
                {stats.totalFAQs}
              </div>
              <div className="text-sm text-orange-800">활성 FAQ</div>
            </div>
          </div>
        </div>

        {/* Database Information */}
        <div className="bg-gray-50 rounded-lg p-4 mb-8">
          <h4 className="font-semibold text-black mb-2">데이터베이스 정보</h4>
          <div className="text-sm text-gray-600 space-y-1">
            <p>• 데이터베이스: Supabase PostgreSQL</p>
            <p>• 저장소: Supabase Storage</p>
            <p>• 실시간 동기화: 지원</p>
            <p>• 백업: Supabase 자동 백업</p>
            <p>• 인덱스: 성능 최적화를 위해 자동 생성</p>
          </div>
        </div>

        {/* Important Notes */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-sm">
              <p className="text-blue-800 font-medium mb-1">
                Supabase 웹 서비스 정보
              </p>
              <ul className="text-blue-700 space-y-1">
                <li>• 모든 데이터는 Supabase 클라우드에 저장됩니다</li>
                <li>• 데이터 백업은 Supabase에서 자동으로 관리됩니다</li>
                <li>
                  • 환경 변수(.env)에서 Supabase 연결 정보를 설정할 수 있습니다
                </li>
                <li>
                  • Supabase 대시보드에서 직접 데이터를 관리할 수 있습니다
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors duration-200"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatabaseSettings;
