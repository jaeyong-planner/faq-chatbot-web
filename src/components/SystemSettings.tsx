import React, { useState, useEffect } from 'react';
import { WebGeminiService } from '../services/WebGeminiService';
import { embeddingService } from '../services/embeddingService';
import { GeminiAPIConfig, CustomerServiceInfo } from '../types';
import { defaultConfig } from '../services/config';
import { useToast } from './Toast';
import { createLogger } from '../services/logger';
import { getSupabaseDatabaseService } from '../services/supabase';

const log = createLogger('SysSettings');
const SystemSettings: React.FC = () => {
  const { showToast } = useToast();
  const dbService = getSupabaseDatabaseService();

  // 모델은 config.ts에서 중앙 관리 (새 모델 출시 시 config.ts만 업데이트)
  const [geminiSettings, setGeminiSettings] = useState<GeminiAPIConfig>({
    apiKey: '',
    isActive: false,
    model: defaultConfig.aiModel.geminiDefaultModel,
    baseUrl: defaultConfig.aiModel.geminiBaseUrl
  });

  const [connectionStatus, setConnectionStatus] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });

  const [showApiKey, setShowApiKey] = useState(false);

  // 고객센터 정보 설정
  const [customerServiceInfo, setCustomerServiceInfo] = useState<CustomerServiceInfo>({
    phone: '1234-5678',
    email: 'support@embrain.com',
    operatingHours: '평일 09:00~18:00'
  });

  // 설정 로드
  useEffect(() => {
    const loadSettings = async () => {
      // 고객센터 정보 로드 (localStorage 우선)
      try {
        const savedCS = localStorage.getItem('customer-service-info');
        if (savedCS) {
          setCustomerServiceInfo(JSON.parse(savedCS));
        }
      } catch { /* ignore */ }

      // Gemini 설정 로드
      try {
        const saved = localStorage.getItem('system-gemini-config');
        const savedStatus = localStorage.getItem('gemini-connection-status');

        if (saved) {
          const parsed = JSON.parse(saved);
          const config: GeminiAPIConfig = {
            apiKey: parsed.apiKey || '',
            isActive: parsed.isActive || false,
            model: defaultConfig.aiModel.geminiDefaultModel,
            baseUrl: defaultConfig.aiModel.geminiBaseUrl
          };
          setGeminiSettings(config);
          WebGeminiService.getInstance().setConfig(config);
          embeddingService.setGeminiConfig(config);

          if (savedStatus) {
            try {
              const ps = JSON.parse(savedStatus);
              const hours = (Date.now() - new Date(ps.testedAt).getTime()) / 3600000;
              if (hours < 24 && ps.status === 'success') {
                setConnectionStatus({ status: 'success', message: ps.message + ' (이전 연결 상태)' });
              }
            } catch { /* ignore */ }
          }
        } else {
          const config = WebGeminiService.getInstance().getConfig();
          setGeminiSettings(config);
          embeddingService.setGeminiConfig(config);
        }
      } catch (error) {
        log.error('설정 로드 실패:', error);
        const config = WebGeminiService.getInstance().getConfig();
        setGeminiSettings(config);
        embeddingService.setGeminiConfig(config);
      }
    };

    loadSettings();
  }, []);

  // 연결 테스트
  const handleTest = async () => {
    if (!geminiSettings.apiKey) {
      setConnectionStatus({ status: 'error', message: 'API 키를 먼저 입력해주세요.' });
      return;
    }

    setConnectionStatus({ status: 'testing', message: '연결을 테스트 중입니다...' });

    try {
      const config = { ...geminiSettings, isActive: true };
      WebGeminiService.getInstance().setConfig(config);
      embeddingService.setGeminiConfig(config);

      const result = await WebGeminiService.getInstance().testConnection();

      if (result.success) {
        setGeminiSettings(prev => ({ ...prev, isActive: true }));
        setConnectionStatus({ status: 'success', message: 'Gemini API 연결 성공' });

        // 자동 저장
        const saveConfig = { ...geminiSettings, isActive: true };
        localStorage.setItem('system-gemini-config', JSON.stringify(saveConfig));
        localStorage.setItem('gemini-connection-status', JSON.stringify({
          status: 'success', message: 'Gemini API 연결 성공', testedAt: new Date().toISOString()
        }));

        // Supabase에도 저장
        try {
          await dbService.setSetting('gemini_api_key', geminiSettings.apiKey);
        } catch (error) {
          log.warn('Supabase 설정 저장 실패:', error);
        }

        showToast('Gemini API 연결 성공! 설정이 자동 저장되었습니다.', 'success');
      } else {
        setConnectionStatus({ status: 'error', message: result.message });
      }
    } catch (error) {
      setConnectionStatus({ status: 'error', message: '연결 테스트 중 오류가 발생했습니다.' });
    }
  };

  // 설정 저장
  const handleSave = async () => {
    try {
      localStorage.setItem('system-gemini-config', JSON.stringify(geminiSettings));
      WebGeminiService.getInstance().setConfig(geminiSettings);
      embeddingService.setGeminiConfig(geminiSettings);

      // Supabase에도 저장
      if (geminiSettings.apiKey) {
        try {
          await dbService.setSetting('gemini_api_key', geminiSettings.apiKey);
        } catch (error) {
          log.warn('Supabase 설정 저장 실패:', error);
        }
      }

      showToast('설정이 저장되었습니다.', 'success');
    } catch (error) {
      showToast('설정 저장에 실패했습니다.', 'error');
    }
  };

  // 고객센터 정보 저장
  const handleSaveCustomerService = async () => {
    try {
      localStorage.setItem('customer-service-info', JSON.stringify(customerServiceInfo));
      showToast('고객센터 정보가 저장되었습니다.', 'success');
    } catch {
      showToast('고객센터 정보 저장에 실패했습니다.', 'error');
    }
  };

  // 설정 삭제
  const handleDelete = () => {
    const resetConfig: GeminiAPIConfig = {
      apiKey: '',
      isActive: false,
      model: defaultConfig.aiModel.geminiDefaultModel,
      baseUrl: defaultConfig.aiModel.geminiBaseUrl
    };

    setGeminiSettings(resetConfig);
    setConnectionStatus({ status: 'idle', message: '' });
    WebGeminiService.getInstance().setConfig(resetConfig);
    embeddingService.setGeminiConfig(resetConfig);

    try {
      localStorage.removeItem('system-gemini-config');
      localStorage.removeItem('gemini-connection-status');
      showToast('설정이 삭제되었습니다.', 'success');
    } catch {
      showToast('설정 삭제 중 오류가 발생했습니다.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-black">시스템 설정</h1>
        <p className="text-gray-600 mt-1">Gemini API 키를 등록하면 모든 기능이 활성화됩니다</p>
      </div>

      {/* Gemini API Key */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-black mb-6 flex items-center">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          Gemini API 키
        </h3>

        {/* API Key Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-600 mb-2">API 키</label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={geminiSettings.apiKey}
              onChange={(e) => setGeminiSettings(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="AIza..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showApiKey ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                ) : (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
              Google AI Studio
            </a>
            에서 API 키를 발급받으세요. 이 키로 임베딩, 문서 분석, FAQ 생성 등 모든 기능이 작동합니다.
          </p>
        </div>


        {/* Connection Status */}
        {connectionStatus.status !== 'idle' && (
          <div className={`mb-6 p-4 rounded-lg flex items-center ${
            connectionStatus.status === 'success' ? 'bg-green-50 border border-green-200 text-green-700' :
            connectionStatus.status === 'error' ? 'bg-red-50 border border-red-200 text-red-700' :
            'bg-blue-50 border border-blue-200 text-blue-700'
          }`}>
            {connectionStatus.status === 'testing' && (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {connectionStatus.status === 'success' && (
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
            {connectionStatus.status === 'error' && (
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
            <span className="text-sm">{connectionStatus.message}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleTest}
            disabled={connectionStatus.status === 'testing' || !geminiSettings.apiKey}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200 font-medium"
          >
            {connectionStatus.status === 'testing' ? '테스트 중...' : '연결 테스트'}
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
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          고객센터 정보 설정
        </h3>

        <p className="text-sm text-gray-500 mb-4">챗봇이 답변을 찾지 못할 때 안내할 고객센터 연락처를 설정합니다.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">전화번호</label>
            <input
              type="text"
              value={customerServiceInfo.phone}
              onChange={(e) => setCustomerServiceInfo(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="1234-5678"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">이메일</label>
            <input
              type="email"
              value={customerServiceInfo.email}
              onChange={(e) => setCustomerServiceInfo(prev => ({ ...prev, email: e.target.value }))}
              placeholder="support@embrain.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">운영 시간</label>
            <input
              type="text"
              value={customerServiceInfo.operatingHours}
              onChange={(e) => setCustomerServiceInfo(prev => ({ ...prev, operatingHours: e.target.value }))}
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

      {/* Info Card */}
      <div className="bg-blue-50 rounded-xl p-5 border border-blue-100">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">API 키 하나로 모든 기능이 작동합니다</h4>
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
