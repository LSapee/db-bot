import {
  GeneratedStudyDayMaterials,
  GeneratedStudyPlan,
  GeneratedStudyPlanDay,
} from '../../openai/openai.service';
import { StudyCourseName } from './discord-study-plan.types';

// Formats one indexed study plan line for list and selection prompts.
// 목록 및 선택 프롬프트에 사용할 번호 포함 학습 계획 요약 한 줄을 만든다.
export function formatIndexedStudyPlanSummary(
  index: number,
  studyPlan: {
    requested_range_text: string | null;
    start_date: Date | null;
    current_day: number;
    total_days: number;
    goal_text: string;
  },
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED' | 'ARCHIVED' = 'ACTIVE',
) {
  const courseName = studyPlan.requested_range_text ?? '미정 코스';

  if (status === 'COMPLETED') {
    return `${index}. ${courseName}`;
  }

  if (status === 'ARCHIVED') {
    return `${index}. ${courseName} - 중도종료.`;
  }

  const startedDate = studyPlan.start_date ? formatStartedDate(studyPlan.start_date) : '시작 전';
  const goalSummary =
    studyPlan.goal_text.length > 40
      ? `${studyPlan.goal_text.slice(0, 40)}...`
      : studyPlan.goal_text;

  const statusText =
    status === 'ACTIVE'
      ? studyPlan.current_day <= 0
        ? '1일차 대기중'
        : `${studyPlan.current_day}일차 진행중`
      : studyPlan.current_day <= 0
        ? '1일차 게시 전 중단'
        : `${studyPlan.current_day}일차에서 중단`;

  return `${index}. ${courseName} / ${startedDate} / ${statusText} / 총 ${studyPlan.total_days}일 / ${goalSummary}`;
}

// Creates an empty-state message for a specific study plan list query.
// 특정 상태의 학습 계획 목록이 비어 있을 때 보여줄 메시지를 만든다.
export function createEmptyStudyPlanListMessage(
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED' | 'ARCHIVED',
) {
  if (status === 'ACTIVE') {
    return '**[학습중인 코스 리스트]**\n현재 학습중인 코스가 없습니다.';
  }

  if (status === 'CANCELLED') {
    return '**[중단된 코스 리스트]**\n현재 중단된 코스가 없습니다.';
  }

  return '**[완료한 코스 리스트]**\n현재 완료한 코스가 없습니다.';
}

// Returns the heading text for a study plan list grouped by status.
// 상태별 학습 계획 목록 제목을 반환한다.
export function getStudyPlanListTitle(status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED' | 'ARCHIVED') {
  if (status === 'ACTIVE') {
    return '**[학습중인 코스 리스트]**';
  }

  if (status === 'CANCELLED') {
    return '**[중단된 코스 리스트]**';
  }

  return '**[완료한 코스 리스트]**';
}

// Formats the generated day-by-day study plan into a Discord-friendly summary message.
// 생성된 일별 학습 계획을 Discord에 보여주기 쉬운 요약 메시지로 만든다.
export function formatGeneratedStudyPlanMessage(generatedStudyPlan: GeneratedStudyPlan) {
  const formattedDays = generatedStudyPlan.days.map((generatedDay) =>
    [
      `**[${generatedDay.dayNumber}일차]**`,
      `목차: ${generatedDay.title}`,
      `내용정리: ${generatedDay.topicSummary}`,
      `학습 목표: ${generatedDay.learningGoal}`,
    ].join('\n'),
  );

  return [
    '**[일정 생성 완료]**',
    `계획명: ${generatedStudyPlan.planTitle}`,
    `전체 목표: ${generatedStudyPlan.goalText}`,
    '',
    '**[일차별 일정]**',
    '',
    ...formattedDays,
    '',
    '**[다음 단계]**',
    '`시작`으로 학습을 시작할 수 있습니다.',
    '`취소`도 입력할 수 있습니다.',
    '취소하면 처음부터 다시 진행해야 합니다.',
  ].join('\n\n');
}

// Returns the first generated study day and validates that day 1 exists.
// 생성된 학습 계획에서 1일차 정보를 찾아 반환한다.
export function getFirstStudyDay(generatedStudyPlan: GeneratedStudyPlan) {
  const firstStudyDay = generatedStudyPlan.days.find((studyDay) => studyDay.dayNumber === 1);

  if (!firstStudyDay) {
    throw new Error('Generated study plan does not contain day 1.');
  }

  return firstStudyDay;
}

// Rebuilds the generated-material shape from stored DB rows so it can be published again.
// DB에 저장된 일차 자료를 다시 게시할 수 있도록 생성 결과 형태로 복원한다.
export function buildGeneratedStudyDayMaterialsFromStoredDay(studyDay: {
  day_contents: {
    summary_text: string | null;
    content_text: string;
  } | null;
  quizzes: {
    intro_text: string | null;
    quiz_items: Array<{
      question_no: number;
      prompt_text: string;
      expected_points: unknown;
      model_answer_text: string;
      explanation_text: string;
      quiz_hints: Array<{
        hint_no: number;
        hint_text: string;
      }>;
    }>;
  } | null;
}): GeneratedStudyDayMaterials {
  if (!studyDay.day_contents || !studyDay.quizzes) {
    throw new Error('Stored study day materials are incomplete.');
  }

  return {
    summaryText: studyDay.day_contents.summary_text ?? '',
    contentText: studyDay.day_contents.content_text,
    quizIntroText: studyDay.quizzes.intro_text ?? '',
    quizItems: studyDay.quizzes.quiz_items.map((quizItem) => ({
      questionNo: quizItem.question_no,
      promptText: quizItem.prompt_text,
      expectedPoints: Array.isArray(quizItem.expected_points)
        ? quizItem.expected_points.map((point) => String(point))
        : [],
      hintTexts: [...quizItem.quiz_hints]
        .sort((leftHint, rightHint) => leftHint.hint_no - rightHint.hint_no)
        .map((quizHint) => quizHint.hint_text),
      modelAnswerText: quizItem.model_answer_text,
      explanationText: quizItem.explanation_text,
    })),
  };
}

// Formats the tutor thread body for one study day.
// 특정 일차 tutor 스레드 본문을 포맷한다.
export function formatTutorThreadMessage(
  studyDay: GeneratedStudyPlanDay,
  studyDayMaterials: GeneratedStudyDayMaterials,
) {
  return [
    `[${studyDay.dayNumber}일차 주제]`,
    `목차: ${studyDay.title}`,
    `내용정리: ${studyDayMaterials.summaryText}`,
    `학습 목표: ${studyDay.learningGoal}`,
    '',
    studyDayMaterials.contentText,
  ].join('\n');
}

// Formats the quiz thread body for one study day.
// 특정 일차 quiz 스레드 본문을 포맷한다.
export function formatQuizThreadMessage(
  studyDay: GeneratedStudyPlanDay,
  studyDayMaterials: GeneratedStudyDayMaterials,
) {
  const formattedQuizItems = studyDayMaterials.quizItems.map((quizItem) =>
    [
      `문제 ${quizItem.questionNo}. ${quizItem.promptText}`,
      ...quizItem.hintTexts.map((hintText, index) => `- 힌트 ${index + 1}: ||${hintText}||`),
    ].join('\n'),
  );

  return [
    `[${studyDay.dayNumber}일차 문제]`,
    `${studyDay.dayNumber}일차 문제와 각 문제별 힌트입니다.`,
    '이 스레드에 아래 형식으로 답안을 제출할 수 있습니다.',
    '!제출 문제 1',
    '```select * \nfrom quizs;```',
    '각 문제는 최대 3번까지 제출할 수 있습니다.',
    studyDayMaterials.quizIntroText,
    '',
    ...formattedQuizItems,
  ].join('\n\n');
}

// Formats the answer thread body for one study day.
// 특정 일차 answer 스레드 본문을 포맷한다.
export function formatAnswerThreadMessage(
  studyDay: GeneratedStudyPlanDay,
  studyDayMaterials: GeneratedStudyDayMaterials,
) {
  const formattedAnswerSections = studyDayMaterials.quizItems.map((quizItem) =>
    [
      `문제 ${quizItem.questionNo}`,
      '- 모범 답안:',
      formatSpoilerCodeBlock(quizItem.modelAnswerText),
      `- 해설: ||${formatInlineSpoilerText(quizItem.explanationText)}||`,
    ].join('\n'),
  );

  return [
    `[${studyDay.dayNumber}일차 정답]`,
    `${studyDay.dayNumber}일차 문제별 모범 답안과 해설입니다.`,
    '',
    ...formattedAnswerSections,
  ].join('\n\n');
}

function formatSpoilerCodeBlock(content: string) {
  const normalizedContent = unwrapOuterCodeFence(content).trim() || '(답안 없음)';

  return ['||```', normalizedContent, '```||'].join('\n');
}

function formatInlineSpoilerText(content: string) {
  return content.replace(/\|\|/g, '| |').replace(/\s+/g, ' ').trim();
}

function unwrapOuterCodeFence(content: string) {
  const trimmedContent = content.trim();
  const matchedCodeFence = /^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/.exec(trimmedContent);

  if (!matchedCodeFence) {
    return trimmedContent.replace(/```/g, '` ` `');
  }

  return matchedCodeFence[1].trim().replace(/```/g, '` ` `');
}

// Formats the user answer thread body with the expected submission syntax.
// 사용자 제출 스레드 본문에 제출 형식 안내를 넣어 포맷한다.
export function formatUserAnswerThreadMessage(studyDay: GeneratedStudyPlanDay) {
  return [
    `[${studyDay.dayNumber}일차 문제 제출 안내]`,
    '이 스레드에서 문제 답안을 제출해주세요.',
    '각 문제는 최대 3번까지 제출할 수 있습니다.',
    '제출 형식은 아래 예시를 따라주세요.',
    '',
    '!제출 문제 1',
    '```sql',
    'SELECT *',
    'FROM example_table;',
    '```',
  ].join('\n');
}

// Formats the user question thread body with the expected question command syntax.
// 사용자 질문 스레드 본문에 질문 형식 안내를 넣어 포맷한다.
export function formatUserAskThreadMessage(studyDay: GeneratedStudyPlanDay) {
  return [
    `[${studyDay.dayNumber}일차 질문 안내]`,
    '이 스레드에서 오늘 학습 내용과 관련된 질문을 남겨주세요.',
    '질문은 하루에 최대 20번까지 가능합니다.',
    '질문 형식은 아래 예시를 따라주세요.',
    '',
    '!질문 서브쿼리와 조인 차이를 오늘 내용 기준으로 다시 설명해주세요.',
  ].join('\n');
}

// Builds a consistent study day thread name with the current start date and day number.
// 시작일과 일차를 포함한 공통 스레드 이름 형식을 만든다.
export function createStudyDayThreadName(
  startedAt: Date,
  selectedCourseName: StudyCourseName,
  studyDay: GeneratedStudyPlanDay,
  suffix?: '문제' | '정답',
) {
  const startedDateText = formatStartedDate(startedAt);
  const baseThreadName =
    `[${startedDateText} 시작 ${selectedCourseName} 코스 ${studyDay.dayNumber}일차] ` +
    `${studyDay.dayNumber}일차 - ${studyDay.title}`;

  if (!suffix) {
    return baseThreadName;
  }

  return `${baseThreadName} ${suffix}`;
}

// Builds the submission thread name for the user_answer forum channel.
// user_answer 포럼 채널에 사용할 제출 스레드 이름을 만든다.
export function createUserAnswerThreadName(
  startedAt: Date,
  selectedCourseName: StudyCourseName,
  studyDay: GeneratedStudyPlanDay,
) {
  const startedDateText = formatStartedDate(startedAt);
  return `[${startedDateText} ${selectedCourseName} 코스] ${studyDay.dayNumber}일차 - 문제 제출`;
}

// Builds the question thread name for the user_ask forum channel.
// user_ask 포럼 채널에 사용할 질문 스레드 이름을 만든다.
export function createUserAskThreadName(
  startedAt: Date,
  selectedCourseName: StudyCourseName,
  studyDay: GeneratedStudyPlanDay,
) {
  const startedDateText = formatStartedDate(startedAt);
  return `[${startedDateText} ${selectedCourseName} 코스] ${studyDay.dayNumber}일차 - 질문`;
}

// Formats a date into the YYYY-MM-DD string used in study day thread names.
// 학습 스레드 이름에 사용하는 YYYY-MM-DD 날짜 문자열로 변환한다.
export function formatStartedDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
