import {
  GeneratedStudyPlan,
  GeneratedStudyPlanDay,
} from '../../openai/openai.service';
import { StudyCourseName } from './discord-study-plan.types';

// Parses a duration message like 10D into the day count.
// 10D 같은 입력에서 학습 일수를 추출한다.
export function parseDurationDays(content: string) {
  const matchedDuration = /^(\d+)D$/.exec(content);

  if (!matchedDuration) {
    return null;
  }

  const parsedDays = Number(matchedDuration[1]);

  if (parsedDays < 5 || parsedDays > 100) {
    return null;
  }

  return parsedDays;
}

// Parses a submission command like "!제출 문제 1" followed by the answer body.
// "!제출 문제 1" 형식의 제출 명령과 답안 본문을 파싱한다.
export function parseSubmissionCommand(content: string) {
  const matchedSubmission = /^!제출\s*문제\s*(\d+)\s+([\s\S]+)$/m.exec(content.trim());

  if (!matchedSubmission) {
    return null;
  }

  const questionNo = Number(matchedSubmission[1]);
  const submissionBody = matchedSubmission[2].trim();
  const matchedCodeBlock = /^```([a-zA-Z]*)\n?([\s\S]+?)\n?```$/m.exec(submissionBody);

  if (!matchedCodeBlock) {
    return null;
  }

  const codeBlockLanguage = matchedCodeBlock[1].trim();
  const answerText = matchedCodeBlock[2].trim();

  if (!answerText) {
    return null;
  }

  return {
    questionNo,
    answerText,
    codeBlockLanguage,
  };
}

// Parses a question command like "!질문 질문내용" into the actual question text.
// "!질문 질문내용" 형식의 입력에서 실제 질문 본문을 추출한다.
export function parseStudyQuestionCommand(content: string) {
  const matchedQuestion = /^!질문\s+([\s\S]+)$/m.exec(content.trim());

  if (!matchedQuestion) {
    return null;
  }

  const questionText = matchedQuestion[1].trim();

  if (!questionText) {
    return null;
  }

  return questionText;
}

// Parses the submission thread name and extracts the date, course, and day context.
// 제출 스레드 이름에서 날짜, 코스, 일차 정보를 추출한다.
export function parseUserAnswerThreadContext(threadName: string) {
  const matchedThreadContext = /^\[(\d{4}-\d{2}-\d{2})\s(입문자|중급자|상급자)\s코스(?:\s([0-9a-fA-F-]{36}))?\]\s(\d+)일차\s-\s문제 제출$/.exec(
    threadName,
  );

  if (!matchedThreadContext) {
    return null;
  }

  return {
    startedDateText: matchedThreadContext[1],
    selectedCourseName: matchedThreadContext[2] as StudyCourseName,
    studyPlanUuid: matchedThreadContext[3] ?? null,
    dayNumber: Number(matchedThreadContext[4]),
  };
}

// Parses the quiz thread name and extracts the date, course, and day context.
// 문제 스레드 이름에서 날짜, 코스, 일차 정보를 추출한다.
export function parseQuizThreadContext(threadName: string) {
  const matchedThreadContext = /^\[(\d{4}-\d{2}-\d{2})\s시작\s(입문자|중급자|상급자)\s코스\s(\d+)일차\]\s\d+일차\s-\s.+\s문제$/.exec(
    threadName,
  );

  if (!matchedThreadContext) {
    return null;
  }

  return {
    startedDateText: matchedThreadContext[1],
    selectedCourseName: matchedThreadContext[2] as StudyCourseName,
    studyPlanUuid: null,
    dayNumber: Number(matchedThreadContext[3]),
  };
}

// Parses the question thread name and extracts the date, course, and day context.
// 질문 스레드 이름에서 날짜, 코스, 일차 정보를 추출한다.
export function parseUserAskThreadContext(threadName: string) {
  const matchedThreadContext = /^\[(\d{4}-\d{2}-\d{2})\s(입문자|중급자|상급자)\s코스(?:\s([0-9a-fA-F-]{36}))?\]\s(\d+)일차\s-\s질문$/.exec(
    threadName,
  );

  if (!matchedThreadContext) {
    return null;
  }

  return {
    startedDateText: matchedThreadContext[1],
    selectedCourseName: matchedThreadContext[2] as StudyCourseName,
    studyPlanUuid: matchedThreadContext[3] ?? null,
    dayNumber: Number(matchedThreadContext[4]),
  };
}

// Parses inputs like "1번 코스 중단" into a numeric study plan index.
// "1번 코스 중단" 같은 입력에서 중단할 학습 계획 번호를 추출한다.
export function parseStopPlanSelection(content: string) {
  const matchedPlanNumber = /^(\d+)번\s*코스\s*중단$/.exec(content.trim());

  if (!matchedPlanNumber) {
    return null;
  }

  return Number(matchedPlanNumber[1]);
}

// Parses inputs like "1번 코스 재개" into a numeric cancelled-plan index.
// "1번 코스 재개" 같은 입력에서 재개할 중단 코스 번호를 추출한다.
export function parseResumePlanSelection(content: string) {
  const matchedPlanNumber = /^(\d+)번\s*코스\s*재개$/.exec(content.trim());

  if (!matchedPlanNumber) {
    return null;
  }

  return Number(matchedPlanNumber[1]);
}

// Parses inputs like "1번 코스 종료" into a numeric cancelled-plan index.
// "1번 코스 종료" 같은 입력에서 중단 코스를 중도 완료 처리할 번호를 추출한다.
export function parseArchivePlanSelection(content: string) {
  const matchedPlanNumber = /^(\d+)번\s*코스\s*종료$/.exec(content.trim());

  if (!matchedPlanNumber) {
    return null;
  }

  return Number(matchedPlanNumber[1]);
}

// Parses the user's course selection into one of the supported course names.
// 사용자의 코스 선택 입력을 지원하는 코스 이름으로 변환한다.
export function parseCourseSelection(content: string): StudyCourseName | null {
  if (content === '입문자') {
    return '입문자';
  }

  if (content === '중급자') {
    return '중급자';
  }

  if (content === '상급자' || content === '고급자') {
    return '상급자';
  }

  return null;
}

// Parses the generated LLM response into separate course sections by heading.
// 생성된 LLM 응답을 제목 기준으로 코스별 섹션으로 분리한다.
export function parseCourseContents(content: string): Record<StudyCourseName, string> | null {
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      if (currentSection) {
        sections.get(currentSection)?.push('');
      }
      continue;
    }

    const detectedSection = detectSectionHeading(line);

    if (detectedSection) {
      currentSection = detectedSection;
      if (!sections.has(detectedSection)) {
        sections.set(detectedSection, []);
      }
      continue;
    }

    if (currentSection) {
      sections.get(currentSection)?.push(line);
    }
  }

  const beginnerContent = sections.get('입문자')?.join('\n').trim();
  const intermediateContent = sections.get('중급자')?.join('\n').trim();
  const advancedContent = sections.get('상급자')?.join('\n').trim();

  if (!beginnerContent || !intermediateContent || !advancedContent) {
    return null;
  }

  return {
    입문자: beginnerContent,
    중급자: intermediateContent,
    상급자: advancedContent,
  };
}

// Converts the stored course text into a supported course-name union.
// DB에 저장된 코스 문자열을 지원하는 코스 이름 타입으로 변환한다.
export function parseStoredStudyCourseName(courseName: string | null): StudyCourseName | null {
  if (courseName === '입문자' || courseName === '중급자' || courseName === '상급자') {
    return courseName;
  }

  return null;
}

// Parses the stored plan_raw JSON back into the generated-plan shape.
// 저장된 plan_raw JSON을 다시 생성 계획 구조로 복원한다.
export function parseStoredGeneratedStudyPlan(planRaw: unknown): GeneratedStudyPlan | null {
  if (!planRaw || typeof planRaw !== 'object') {
    return null;
  }

  const rawPlan = planRaw as {
    planTitle?: unknown;
    goalText?: unknown;
    days?: unknown;
  };

  if (
    typeof rawPlan.planTitle !== 'string' ||
    typeof rawPlan.goalText !== 'string' ||
    !Array.isArray(rawPlan.days)
  ) {
    return null;
  }

  const parsedDays = rawPlan.days
    .map((rawDay) => {
      if (!rawDay || typeof rawDay !== 'object') {
        return null;
      }

      const candidateDay = rawDay as {
        dayNumber?: unknown;
        title?: unknown;
        topicSummary?: unknown;
        learningGoal?: unknown;
        scopeText?: unknown;
      };

      if (
        typeof candidateDay.dayNumber !== 'number' ||
        typeof candidateDay.title !== 'string' ||
        typeof candidateDay.topicSummary !== 'string' ||
        typeof candidateDay.learningGoal !== 'string' ||
        typeof candidateDay.scopeText !== 'string'
      ) {
        return null;
      }

      return {
        dayNumber: candidateDay.dayNumber,
        title: candidateDay.title,
        topicSummary: candidateDay.topicSummary,
        learningGoal: candidateDay.learningGoal,
        scopeText: candidateDay.scopeText,
      };
    })
    .filter((parsedDay): parsedDay is GeneratedStudyPlanDay => Boolean(parsedDay));

  if (parsedDays.length === 0) {
    return null;
  }

  return {
    planTitle: rawPlan.planTitle,
    goalText: rawPlan.goalText,
    days: parsedDays,
  };
}

// Detects which section heading a line belongs to even when markdown decoration is present.
// 마크다운 장식이 섞여 있어도 해당 줄이 어떤 섹션 제목인지 판별한다.
function detectSectionHeading(line: string): string | null {
  if (line.includes('입문자 코스')) {
    return '입문자';
  }

  if (line.includes('중급자 코스')) {
    return '중급자';
  }

  if (line.includes('상급자 코스') || line.includes('고급자 코스')) {
    return '상급자';
  }

  return null;
}
