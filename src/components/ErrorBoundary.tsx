import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-gray-800 rounded-lg shadow-xl p-8">
            <div className="flex items-center mb-6">
              <svg
                className="w-12 h-12 text-red-500 mr-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h2 className="text-2xl font-bold text-white">
                렌더링 오류가 발생했습니다
              </h2>
            </div>

            <div className="bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4 mb-6">
              <p className="text-red-200 font-semibold mb-2">오류 메시지:</p>
              <pre className="text-red-100 whitespace-pre-wrap text-sm">
                {this.state.error?.message || "알 수 없는 오류"}
              </pre>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  해결 방법:
                </h3>
                <ul className="list-disc list-inside text-gray-300 space-y-2">
                  <li>아래 버튼을 클릭하여 앱을 다시 시작하세요</li>
                  <li>문제가 계속되면 브라우저 캐시를 삭제해보세요</li>
                  <li>
                    개발자 도구(F12)에서 자세한 오류 내용을 확인할 수 있습니다
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-gray-700">
                <button
                  onClick={this.handleReset}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center"
                >
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  다시 시도
                </button>
              </div>

              <details className="mt-4">
                <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
                  기술적인 세부 정보 표시
                </summary>
                <pre className="mt-2 bg-gray-900 p-4 rounded text-xs text-gray-400 overflow-auto max-h-96">
                  {this.state.errorInfo?.componentStack || "세부 정보 없음"}
                </pre>
              </details>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
