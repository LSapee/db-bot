import { ChannelType } from 'discord.js';

export const discordDailyCategoryName = 'db_daily';

export const discordStudyPlanDurationRecommendationMessage =
  [
    '**권장 최소 일정**',
    '입문자',
    '- 핵심 요약만 학습: 5~7일',
    '- 자세하게 학습: 7일 이상',
    '중급자',
    '- 핵심 요약만 학습: 10~14일',
    '- 자세하게 학습: 14일 이상',
    '상급자',
    '- 핵심 요약만 학습: 20~30일',
    '- 자세하게 학습: 30일 이상',
    '- 주의: 상급자는 실제 숙련까지 더 긴 기간이 필요할 수 있습니다.',
  ].join('\n');

export const discordStudyPlanWelcomeMessage = [
  '**[학습 시작 안내]**',
  '저는 DB학습을 도와주는 AI입니다.',
  '새로운 학습을 진행하시고 싶으시면 `새 학습`을 입력해주세요.',
  '자세한 명령어에 대해서는 `-h`를 입력하시면 알 수 있습니다.',
].join('\n');

export const discordStudyPlanHelpMessage = [
  '**[명령어 안내]**',
  '`숫자 + D` : 새 학습 기간 입력',
  '`-h` : 전체 명령어와 흐름 보기',
  '`리스트` : 현재 학습중인 코스 보기',
  '`N번 코스 중단` : 학습중인 코스 중단',
  '`중단리스트` : 현재 중단된 코스 보기',
  '`N번 코스 재개` : 중단된 코스 다시 진행',
  '`N번 코스 종료` : 중단된 코스 중도 완료 처리',
  '`완료리스트` : 완료한 코스 보기',
  '',
  '**[기본 흐름]**',
  '1. `새 학습` 입력',
  '2. `10D`처럼 학습 기간 입력',
  '3. 입문자 / 중급자 / 상급자 중 하나 선택',
  '4. 선택한 난이도의 간단 일정을 확인한 뒤 `Y` 입력',
  '5. 상세 일정 확인 후 `시작` 입력',
  '6. db_tutor / db_quiz / db_answer / user_answer 채널 사용',
].join('\n');

export const discordStudyPlanInvalidDurationMessage = [
  '**[입력 오류]**',
  '죄송합니다. 해당 메시지는 처리할 수 없습니다.',
  '다시 한 번 `숫자 + D` 형식으로 입력해주세요. (최소 5일, 최대 100일)',
  '도움이 필요하시면 `-h`를 입력해주세요.',
  '**예시**',
  '- 5D',
  '- 10D',
  '- 100D',
  discordStudyPlanDurationRecommendationMessage,
].join('\n');

export const discordUnsupportedStudyPlanCommandMessage = [
  '**[입력 오류]**',
  '지원하지 않는 기능입니다.',
  '도움이 필요하시면 `-h`를 입력해주세요.',
].join('\n');

export const discordStudyPlanNewPlanPromptMessage = [
  '**[학습 기간 설정]**',
  '몇 일 동안 학습하실 예정이신가요? `숫자 + D` 형식으로 알려주세요. (최소 5일, 최대 100일)',
  '**예시**',
  '- 5D',
  '- 10D',
  '- 100D',
  discordStudyPlanDurationRecommendationMessage,
].join('\n');

export const discordStudyPlanCancelledMessage = [
  '**[학습 계획 취소]**',
  '새로운 학습 계획을 취소하였습니다.',
  '새로운 학습 일정을 계획하시려면 `새 학습`을 입력해주세요.',
  '자세한 명령어는 `-h`를 입력하시면 확인할 수 있습니다.',
].join('\n');

export const discordStudyPlanAlreadyStartingMessage = [
  '**[학습 시작 진행 중]**',
  '이미 같은 코스의 학습 시작 처리를 진행하고 있습니다.',
  '잠시 후 완료 메시지를 확인해주세요.',
].join('\n');

export const createDiscordCourseSelectionPromptMessage = (
  days: number,
  courseSelectionSummaryText: string,
) =>
  [
    '**[코스 선택]**',
    `학습 기간이 ${days}일로 설정되었습니다.`,
    '',
    '**[코스 가이드]**',
    '',
    courseSelectionSummaryText,
    '',
    '원하시는 코스를 말씀해주세요.',
    '입문자 / 중급자 / 상급자 중 하나로 응답해주세요.',
  ].join('\n');

export const discordFixedCourseSelectionSummaryText = [
  '입문자',
  '- 처음 DB를 접하시거나, 기초 개념과 간단한 SQL부터 다시 차근차근 익히고 싶은 분께 적합합니다.',
  '',
  '중급자',
  '- 기본 조회문은 익숙하고, JOIN, 서브쿼리, 정규화, 인덱스, 트랜잭션 기초까지 확장하고 싶은 분께 적합합니다.',
  '',
  '상급자',
  '- SQL과 DB 기본기는 갖추고 있고, 설계 품질, 성능, 실행 계획, 운영 관점까지 깊게 학습하고 싶은 분께 적합합니다.',
].join('\n');

export const discordInvalidCourseSelectionMessage = [
  '**[입력 오류]**',
  '코스 선택 단계에서는 입문자 / 중급자 / 상급자 중 하나만 입력할 수 있습니다.',
  '다시 선택해주세요.',
  '도움이 필요하시면 `-h`를 입력해주세요.',
  '입문자 / 중급자 / 상급자',
].join('\n');

export const createDiscordCourseConfirmationPromptMessage = (courseName: string) =>
  [
    '**[코스 미리보기 확인]**',
    '이 간단 일정으로 상세 계획을 생성하시려면 `확인`을 입력해주세요.',
    '취소하시려면 `취소`를 입력해주세요.',
    '취소하면 처음부터 다시 진행해야 합니다.',
    `현재 선택중인 코스: ${courseName}`,
  ].join('\n\n');

export const discordInvalidCourseConfirmationMessage = [
  '**[입력 오류]**',
  '코스 미리보기 확인 단계에서는 `확인` 또는 `취소`만 입력할 수 있습니다.',
  '다시 입력해주세요.',
].join('\n');

export const createDiscordSelectedCourseMessage = (
  courseName: string,
  courseContent: string,
) =>
  [
    '**[선택한 코스 미리보기]**',
    `선택한 코스는 ${courseName}입니다.`,
    courseContent,
    createDiscordCourseConfirmationPromptMessage(courseName),
  ].join('\n\n');

export const discordStudyPlanStartPromptMessage = [
  '**[학습 시작 대기]**',
  '`시작`으로 학습을 시작할 수 있습니다.',
  '`취소`도 입력할 수 있습니다.',
  '취소하면 처음부터 다시 진행해야 합니다.',
].join('\n');

function getDiscordStudyPlanGenerationEstimate(days: number) {
  if (days <= 14) {
    return '보통 10초에서 30초 정도 걸릴 수 있습니다.';
  }

  if (days <= 30) {
    return '보통 20초에서 45초 정도 걸릴 수 있습니다.';
  }

  if (days <= 60) {
    return '보통 30초에서 60초 정도 걸릴 수 있습니다.';
  }

  return '보통 40초에서 90초 정도 걸릴 수 있습니다.';
}

const discordStudyPlanGenerationRetryGuide =
  '3분 이상 걸릴 시 `취소` 입력 후 다시 시도해주세요.';

export const createDiscordStudyCoursePreviewLoadingMessage = (days: number) =>
  [
    '**[생성 중]**',
    '해당 코스 미리보기를 생성하고 있습니다.',
    getDiscordStudyPlanGenerationEstimate(days),
    discordStudyPlanGenerationRetryGuide,
  ].join('\n');

export const createDiscordDetailedPlanLoadingMessage = (days: number) =>
  [
    '**[생성 중]**',
    `${days}일 기준으로 일별 학습 일정을 세분화하고 있습니다.`,
    getDiscordStudyPlanGenerationEstimate(days),
    discordStudyPlanGenerationRetryGuide,
  ].join('\n');

export const createDiscordStudyStartLoadingMessage = (days: number) =>
  [
    '**[생성 중]**',
    '1일차 학습 내용, 문제, 힌트, 정답을 준비하고 있습니다.',
    getDiscordStudyPlanGenerationEstimate(days),
    discordStudyPlanGenerationRetryGuide,
  ].join('\n');

export const createDiscordExistingStudyPlanPromptMessage = (
  activePlanSummaryLines: string[],
) =>
  [
    '**[기존 학습 확인]**',
    '현재 진행중인 학습이 최대입니다.',
    ...activePlanSummaryLines,
    '`N번 코스 중단`, `N번 코스 종료`, 또는 `취소`를 입력해주세요.',
    '취소하면 처음부터 다시 진행해야 합니다.',
  ].join('\n');

export const createDiscordExistingStudyPlanInvalidSelectionMessage = () =>
  [
    '**[입력 오류]**',
    '`N번 코스 중단`, `N번 코스 종료`, 또는 `취소`만 입력할 수 있습니다.',
    '도움이 필요하시면 `-h`를 입력해주세요.',
  ].join('\n');

export const discordCancelledStudyPlanLimitMessage = [
  '**[중단 제한]**',
  '중단된 코스는 최대 3개까지만 보관할 수 있습니다.',
  '기존 중단 코스를 정리한 뒤 다시 시도해주세요.',
].join('\n');

export const discordActiveStudyPlanLimitMessage = [
  '**[재개 제한]**',
  '현재 학습중인 코스가 이미 3개입니다.',
  '기존 코스를 중단한 뒤 다시 재개해주세요.',
].join('\n');

export const discordResumeStudyPlanInvalidSelectionMessage = [
  '**[입력 오류]**',
  '중단리스트 기준으로 `N번 코스 재개` 형식만 입력할 수 있습니다.',
  '도움이 필요하시면 `-h`를 입력해주세요.',
].join('\n');

export const discordArchiveStudyPlanInvalidSelectionMessage = [
  '**[입력 오류]**',
  '중단리스트 기준으로 `N번 코스 종료` 형식만 입력할 수 있습니다.',
  '도움이 필요하시면 `-h`를 입력해주세요.',
].join('\n');

export const discordStopStudyPlanInvalidSelectionMessage = [
  '**[입력 오류]**',
  '리스트 기준으로 `N번 코스 중단` 형식만 입력할 수 있습니다.',
  '도움이 필요하시면 `-h`를 입력해주세요.',
].join('\n');

export const discordStopStudyPlanNotActiveMessage = (planNumber: number) =>
  [
    '**[입력 오류]**',
    `해당 ${planNumber}번 코스는 진행중이지 않습니다.`,
    '도움이 필요하시면 `-h`를 입력해주세요.',
  ].join('\n');

export const discordActiveStudyPlanListActionGuideMessage = [
  '학습을 중단하시려면 `N번 코스 중단`을 입력해주세요.',
  '예시) `1번 코스 중단`',
  '취소하시려면 `취소`를 입력해주세요.',
  '취소하면 처음부터 다시 진행해야 합니다.',
].join('\n');

export const discordCancelledStudyPlanListActionGuideMessage = [
  '중단된 코스를 다시 진행하시려면 `N번 코스 재개`를 입력해주세요.',
  '중단된 코스를 완료 처리하시려면 `N번 코스 종료`를 입력해주세요.',
  '예시) `1번 코스 재개`, `1번 코스 종료`',
  '취소하시려면 `취소`를 입력해주세요.',
].join('\n');

export const discordRequiredChannels = [
  {
    name: 'db_study_plan',
    type: ChannelType.GuildText,
    useDailyCategory: false,
  },
  {
    name: 'db_tutor',
    type: ChannelType.GuildForum,
    useDailyCategory: true,
  },
  {
    name: 'db_quiz',
    type: ChannelType.GuildForum,
    useDailyCategory: true,
  },
  {
    name: 'user_answer',
    type: ChannelType.GuildForum,
    useDailyCategory: true,
  },
  {
    name: 'user_ask',
    type: ChannelType.GuildForum,
    useDailyCategory: true,
  },
  {
    name: 'db_answer',
    type: ChannelType.GuildForum,
    useDailyCategory: true,
  },
] as const;
