import * as XLSX from 'xlsx';
import type { ChatSession, ChatAnalytics, DashboardMetrics } from '../types';

const getDateString = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const downloadWorkbook = (wb: XLSX.WorkBook, fileName: string): void => {
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'completed': return '완료';
    case 'ongoing': return '진행중';
    case 'abandoned': return '중단됨';
    default: return '알 수 없음';
  }
};

export const exportChatLogsToExcel = (sessions: ChatSession[]): void => {
  const wb = XLSX.utils.book_new();
  const headers = [
    '사용자명', '이메일', '시작시간', '종료시간',
    '메시지수', '상태', '만족도', '카테고리', '해결여부'
  ];
  const rows = sessions.map(s => [
    s.user || '익명 사용자',
    s.userEmail || '',
    s.startTime ? new Date(s.startTime).toLocaleString('ko-KR') : '',
    s.endTime ? new Date(s.endTime).toLocaleString('ko-KR') : '',
    s.messageCount ?? 0,
    getStatusText(s.status),
    s.satisfaction != null ? `${s.satisfaction}/5` : '평가없음',
    s.category || '기타',
    s.isResolved ? 'O' : 'X'
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 15 }, { wch: 25 }, { wch: 22 }, { wch: 22 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, '채팅로그');
  downloadWorkbook(wb, `채팅로그_${getDateString()}.xlsx`);
};

export const exportAnalyticsToExcel = (analytics: ChatAnalytics, period: string): void => {
  const wb = XLSX.utils.book_new();
  const hourlyHeaders = ['시간대', '질문 수'];
  const hourlyRows = analytics.hourlyDistribution.map(h => [`${h.hour}시`, h.count]);
  const ws1 = XLSX.utils.aoa_to_sheet([hourlyHeaders, ...hourlyRows]);
  ws1['!cols'] = [{ wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, '시간대별 질문 분포');

  const topHeaders = ['순위', '질문', '횟수', '카테고리'];
  const topRows = analytics.topQuestions.map((q, i) => [i + 1, q.question, q.count, q.category || '']);
  const ws2 = XLSX.utils.aoa_to_sheet([topHeaders, ...topRows]);
  ws2['!cols'] = [{ wch: 8 }, { wch: 50 }, { wch: 10 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws2, '인기 질문 TOP');

  const totalQuestions = analytics.hourlyDistribution.reduce((sum, h) => sum + h.count, 0);
  const summaryData = [
    ['항목', '값'],
    ['조회 기간', period],
    ['총 질문 수', totalQuestions],
    ['활성 사용자 수', analytics.activeUsers],
    ['평균 만족도', analytics.satisfactionAverage != null ? `${analytics.satisfactionAverage.toFixed(1)}/5` : '-'],
    ['세션 해결률', analytics.resolutionRate != null ? `${(analytics.resolutionRate * 100).toFixed(1)}%` : '-']
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(summaryData);
  ws3['!cols'] = [{ wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws3, '요약 통계');
  downloadWorkbook(wb, `채팅분석_리포트_${getDateString()}.xlsx`);
};

export const exportDashboardToExcel = (metrics: DashboardMetrics): void => {
  const wb = XLSX.utils.book_new();
  const avgResponseText = metrics.avgResponseTimeMs != null
    ? (metrics.avgResponseTimeMs < 1000
      ? `${Math.round(metrics.avgResponseTimeMs)}ms`
      : `${(metrics.avgResponseTimeMs / 1000).toFixed(1)}초`)
    : '데이터 없음';

  const summaryData = [
    ['지표', '값'],
    ['총 FAQ 수', metrics.totalFaqs],
    ['이번 달 질문', metrics.monthlyQuestions],
    ['응답률', `${(metrics.responseRate * 100).toFixed(1)}%`],
    ['평균 응답 시간', avgResponseText],
    ['마지막 활동', metrics.lastActivity ? new Date(metrics.lastActivity).toLocaleString('ko-KR') : '데이터 없음']
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1['!cols'] = [{ wch: 18 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws1, '주요 지표');

  const catHeaders = ['카테고리', '건수'];
  const catRows = metrics.faqCategoryDistribution.map(c => [c.category, c.count]);
  const ws2 = XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]);
  ws2['!cols'] = [{ wch: 20 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, '카테고리 분포');

  const actHeaders = ['활동', '항목', '시간'];
  const actRows = metrics.recentActivities.map(a => [
    a.action, a.item,
    a.timestamp ? new Date(a.timestamp).toLocaleString('ko-KR') : ''
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet([actHeaders, ...actRows]);
  ws3['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws3, '최근 활동');
  downloadWorkbook(wb, `대시보드_${getDateString()}.xlsx`);
};
