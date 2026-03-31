import { Injectable, Logger } from '@nestjs/common';
import { OpenAiClientService } from '../client/openai-client.service';
import {
  GeneratedStudyDayMaterials,
  GeneratedStudyPlan,
  GeneratedStudyPlanDay,
} from '../common/openai.types';

@Injectable()
export class OpenAiPlanService {
  private readonly logger = new Logger(OpenAiPlanService.name);

  constructor(private readonly openAiClientService: OpenAiClientService) {}

  // Requests a short study direction answer for a DB study plan of the given duration.
  // 주어진 학습 일수에 맞는 DB 학습 방향성 답변을 짧게 요청한다.
  async getStudyDirection(days: number) {
    const client = this.openAiClientService.requireClient();

    const response = await client.responses.create(this.buildStudyDirectionRequest(days));

    let outputText = response.output_text.trim();

    if (!this.hasExactDayCoverage(outputText, days)) {
      this.logger.warn(
        `Study direction schedule did not match ${days} days exactly. Regenerating once.`,
      );

      const retryResponse = await client.responses.create(
        this.buildStudyDirectionRequest(days, [
          `이전 응답의 일정 합계가 정확히 ${days}일이 아니었습니다.`,
          `각 코스의 마지막 일정은 반드시 ${days}일차에서 끝나야 합니다.`,
          '각 코스의 일정 표기는 반드시 N일차 또는 A~B일차 형식만 사용하세요.',
        ].join(' ')),
      );

      outputText = retryResponse.output_text.trim();
    }

    return outputText;
  }

  // Requests a short single-course preview for the selected level and duration.
  // 선택한 난이도 하나에 대한 간단 일정 미리보기를 요청한다.
  async getStudyCoursePreview(days: number, selectedCourseName: string) {
    const client = this.openAiClientService.requireClient();

    const response = await client.responses.create(
      this.buildStudyCoursePreviewRequest(days, selectedCourseName),
    );

    let outputText = response.output_text.trim();

    if (!this.hasExactDayCoverage(outputText, days)) {
      this.logger.warn(
        `Study course preview did not match ${days} days exactly for ${selectedCourseName}. Regenerating once.`,
      );

      const retryResponse = await client.responses.create(
        this.buildStudyCoursePreviewRequest(
          days,
          selectedCourseName,
          [
            `이전 응답의 일정 합계가 정확히 ${days}일이 아니었습니다.`,
            `마지막 일정은 반드시 ${days}일차에서 끝나야 합니다.`,
            '일정 표기는 반드시 N일차 또는 A~B일차 형식만 사용하세요.',
          ].join(' '),
        ),
      );

      outputText = retryResponse.output_text.trim();
    }

    return outputText;
  }

  // Generates a day-by-day study plan for the confirmed course selection.
  // 확정된 코스 선택을 기준으로 일별 학습 계획을 생성한다.
  async getDetailedStudyPlan(
    days: number,
    selectedCourseName: string,
    selectedCourseContent: string,
  ): Promise<GeneratedStudyPlan> {
    const client = this.openAiClientService.requireClient();
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await client.responses.create(
          this.buildDetailedStudyPlanRequest(
            days,
            selectedCourseName,
            selectedCourseContent,
            attempt === 1
              ? undefined
              : [
                  '이전 응답이 JSON 파싱 또는 검증에 실패했습니다.',
                  '반드시 유효한 JSON 객체만 반환하고, 설명 문장이나 주석을 추가하지 마세요.',
                  `days 배열 길이는 정확히 ${days}개여야 합니다.`,
                ].join(' '),
          ),
        );

        return this.parseDetailedStudyPlan(response.output_text, days);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Detailed study plan generation attempt ${attempt} failed: ${this.getErrorMessage(error)}`,
        );
      }
    }

    throw new Error(
      `상세 학습 계획 생성에 실패했습니다. 원인: ${this.getErrorMessage(lastError)}`,
    );
  }

  // Generates the study content, quiz, hints, and answer guide for one study day.
  // 특정 학습 일차에 대한 학습 내용, 퀴즈, 힌트, 정답 해설을 생성한다.
  async getStudyDayMaterials(
    planTitle: string,
    goalText: string,
    selectedCourseName: string,
    studyDay: GeneratedStudyPlanDay,
  ): Promise<GeneratedStudyDayMaterials> {
    const client = this.openAiClientService.requireClient();
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await client.responses.create(
          this.buildStudyDayMaterialsRequest(
            planTitle,
            goalText,
            selectedCourseName,
            studyDay,
            attempt === 1
              ? undefined
              : [
                  '이전 응답이 JSON 파싱 또는 검증에 실패했습니다.',
                  '반드시 유효한 JSON 객체만 반환하고, 설명 문장이나 주석을 추가하지 마세요.',
                  'quizItems는 정확히 10개여야 하고, 각 문제에는 modelAnswerText와 explanationText가 반드시 있어야 합니다.',
                ].join(' '),
          ),
        );

        return this.parseStudyDayMaterials(response.output_text);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Study day materials generation attempt ${attempt} failed: ${this.getErrorMessage(error)}`,
        );
      }
    }

    throw new Error(
      `학습 자료 생성에 실패했습니다. 원인: ${this.getErrorMessage(lastError)}`,
    );
  }

  // Builds the reusable Responses API body for one day of study materials.
  // 하루치 학습 자료 생성용 Responses API 요청 본문을 재사용 가능하게 반환한다.
  buildStudyDayMaterialsBatchRequest(
    planTitle: string,
    goalText: string,
    selectedCourseName: string,
    studyDay: GeneratedStudyPlanDay,
  ) {
    return this.buildStudyDayMaterialsRequest(
      planTitle,
      goalText,
      selectedCourseName,
      studyDay,
    );
  }

  // Parses raw batch output text into one day of study materials.
  // Batch 결과 텍스트를 하루치 학습 자료 구조로 파싱한다.
  parseStudyDayMaterialsBatchOutput(content: string) {
    return this.parseStudyDayMaterials(content);
  }

  // Builds the OpenAI request used to generate the detailed day-by-day study plan.
  // 일별 상세 학습 계획 생성을 위한 OpenAI 요청 본문을 구성한다.
  private buildDetailedStudyPlanRequest(
    days: number,
    selectedCourseName: string,
    selectedCourseContent: string,
    extraInstruction?: string,
  ) {
    return {
      model: this.openAiClientService.model,
      instructions: [
        'You are generating a detailed DB study plan.',
        'Answer in Korean.',
        'Return JSON only.',
        'Do not wrap the JSON in markdown fences.',
        'The JSON shape must be: {"planTitle": string, "goalText": string, "days": [{ "dayNumber": number, "title": string, "topicSummary": string, "learningGoal": string, "scopeText": string }]}',
        `The days array length must be exactly ${days}.`,
        `dayNumber must start at 1 and end at ${days}.`,
        'Keep each title concise.',
        'topicSummary and learningGoal should be short but clear.',
        'scopeText should describe what is covered that day in one compact but concrete paragraph.',
        'scopeText should not be vague. It should mention what concepts, examples, table structures, SQL patterns, or common mistakes will be covered that day.',
        'Each day should feel like a real lesson with explanation, example, and practice direction, not just a short topic label.',
        extraInstruction ?? '',
      ]
        .filter(Boolean)
        .join(' '),
      input: [
        `선택된 코스는 ${selectedCourseName} 코스입니다.`,
        '아래 코스 설명을 기준으로 일별 학습 계획을 세분화해주세요.',
        selectedCourseContent,
        `반드시 총 ${days}일치 계획을 만들어주세요.`,
      ].join('\n\n'),
    };
  }

  // Builds the OpenAI request used to generate one selected course preview only.
  // 선택된 난이도 하나에 대한 간단 일정 미리보기 생성을 위한 요청 본문을 구성한다.
  private buildStudyCoursePreviewRequest(
    days: number,
    selectedCourseName: string,
    extraInstruction?: string,
  ) {
    const recommendedScheduleGuide =
      selectedCourseName === '입문자'
        ? '핵심 요약만 학습: 5~7일 / 자세하게 학습: 7일 이상'
        : selectedCourseName === '중급자'
          ? '핵심 요약만 학습: 10~14일 / 자세하게 학습: 14일 이상'
          : '핵심 요약만 학습: 20~30일 / 자세하게 학습: 30일 이상 / 실제 숙련까지는 더 긴 기간이 필요할 수 있음';

    return {
      model: this.openAiClientService.model,
      instructions: [
        'You are generating a short preview of one DB learning course.',
        'Answer in Korean.',
        'Return plain text only.',
        `Generate only the ${selectedCourseName} course.`,
        `Use the exact heading [${selectedCourseName} 코스].`,
        'After the heading, add one line exactly as "권장 학습 가이드".',
        'Then add one line that starts with "핵심 요약만 학습: ".',
        'Then add one line that starts with "자세하게 학습: ".',
        'If the selected course is 상급자, add one more caution line that starts with "주의: ".',
        'Then repeat this exact structure for each section: one line starting with 목차 (일정), followed by 2 to 3 lines of 핵심 내용.',
        `The full schedule must cover exactly ${days} days.`,
        `The last schedule must end at ${days}일차.`,
        'Schedule notation must use only N일차 or A~B일차.',
        'Keep the preview concise but concrete enough to help the user decide whether to use this course.',
        'Avoid vague summaries like "기본 개념을 배웁니다" only. Each section should reveal what will actually be learned or practiced.',
        extraInstruction ?? '',
      ]
        .filter(Boolean)
        .join(' '),
      input: [
        `DB를 ${days}일 동안 학습하려고 합니다.`,
        `${selectedCourseName} 코스 하나만 생성해주세요.`,
        `권장 학습 가이드는 ${recommendedScheduleGuide} 입니다.`,
        '설명은 너무 길지 않게 하되, 각 목차 아래 핵심 내용은 선택 판단에 도움이 되도록 구체적으로 적어주세요.',
      ].join('\n\n'),
    };
  }

  // Builds the OpenAI request used to generate one day of study materials.
  // 하루치 학습 자료 생성을 위한 OpenAI 요청 본문을 구성한다.
  private buildStudyDayMaterialsRequest(
    planTitle: string,
    goalText: string,
    selectedCourseName: string,
    studyDay: GeneratedStudyPlanDay,
    extraInstruction?: string,
  ) {
    return {
      model: this.openAiClientService.model,
      instructions: [
        'You are an expert database instructor, curriculum designer, and practical SQL educator creating one study day package for a DB learning bot.',
        'Answer in Korean.',
        'Return JSON only.',
        'Do not wrap the JSON in markdown fences.',
        'The JSON shape must be: {"summaryText": string, "contentText": string, "quizIntroText": string, "quizItems": [{ "questionNo": number, "promptText": string, "expectedPoints": string[], "hintTexts": string[], "modelAnswerText": string, "explanationText": string }]}',
        'quizItems must contain exactly 10 items.',
        'questionNo must start at 1 and increase by 1.',
        'Each hintTexts array must contain exactly 3 hints.',
        'Hint 1 should be indirect and only suggest the solving direction.',
        'Hint 2 should be direct and mention the relevant concept, clause, or approach.',
        'Hint 3 should be highly decisive and almost lead to the final answer without fully revealing it.',
        'contentText should be substantial enough for 45 to 60 minutes of beginner study including reading, thinking, and self-checking.',
        'contentText should include clear explanations, comparisons, examples, practical notes, and common mistakes instead of a short summary.',
        'contentText should explain not only definitions but also why each concept matters in real database usage, schema design, querying, data integrity, and maintenance.',
        'contentText should explain terms, concepts, examples, relationships between concepts, and common mistakes in enough depth for a beginner to study without extra materials.',
        'contentText should include concrete and realistic examples rather than abstract descriptions only.',
        'contentText must feel like a real lesson, not a short memo or blog summary.',
        'contentText should include at least 2 concrete worked examples, mini cases, or realistic scenarios.',
        'When the topic is conceptual, contentText should still include table, row, column, key, or business-data examples that make the idea tangible.',
        'Whenever a concept is introduced, immediately connect it to a realistic usage example such as 회원, 주문, 상품, 재고, 게시글, 출결, 성적, 결제, 예약, or 로그 data.',
        'Do not stop at definition. Show how the concept would actually appear in a table, row, or service situation.',
        'At least one example should show sample rows or a mini table and explain how to read it.',
        'At least one example should explain what real confusion, bug, or data-management problem happens if the concept is misunderstood.',
        'Include one explicit common-mistake paragraph and one explicit self-check paragraph.',
        'Prefer step-by-step interpretation, comparison, and practical reading of examples over repeating the same definition in different words.',
        'contentText should include at least one short self-check or reflection segment that asks the learner to distinguish, classify, or reason about the concept.',
        'When relevant, contentText should naturally cover definition, purpose, structure, comparison, practical example, common mistake, and recap.',
        'contentText should be written as plain text learning material, not markdown notes.',
        'contentText must be split into 6 to 10 short paragraphs with a blank line between paragraphs.',
        'Each paragraph should usually contain 2 to 5 sentences.',
        'Avoid long unbroken blocks of text.',
        'Target roughly 1800 Korean characters or more for contentText unless the topic is extremely narrow.',
        'Whenever SQL syntax, query examples, clauses, or sample statements appear inside contentText, they must be wrapped in fenced sql code blocks.',
        'Do not leave SQL fragments inline inside long paragraphs when readability would suffer.',
        'When comparison or structure helps understanding, include a markdown table.',
        'Markdown tables must always be wrapped inside fenced code blocks.',
        'quizIntroText should briefly explain what the learner should solve today.',
        'expectedPoints should be short bullet-style checkpoints.',
        'modelAnswerText and explanationText should be practical and concrete.',
        "Every quiz item must be answerable from the contentText and today's learning scope without requiring outside knowledge.",
        'Avoid questions that depend on topics not taught today.',
        'Do not use markdown headings, markdown bullets, or markdown emphasis.',
        'Use plain text sentences and markdown tables where needed.',
        'If a table is needed, use a markdown table instead of an ASCII table.',
        'Whenever you output a markdown table, place it inside a fenced code block.',
        'If today is a SQL query practice day, generate 6 to 8 SQL query problems and 2 to 4 knowledge questions.',
        'If quiz problems reference any table names or sample data, quizIntroText must include shared setup SQL before the problems.',
        'Shared setup SQL must contain both CREATE TABLE statements and INSERT statements.',
        'Put the shared CREATE TABLE SQL and INSERT SQL only once in quizIntroText using fenced sql code blocks.',
        'Label them clearly as [테이블 생성 SQL] and [예제 데이터 INSERT SQL].',
        'Do not repeat table creation SQL or sample INSERT SQL inside each quiz item.',
        'Each SQL quiz item should reference the shared schema and data introduced in quizIntroText.',
        'Knowledge questions should ask for concepts, behavior, or reasoning rather than SQL writing.',
        'modelAnswerText must never be empty and should contain a direct answer or SQL query.',
        "explanationText must explain why the answer is correct based on today's lesson.",
        'quizIntroText and promptText should also avoid markdown except fenced sql code blocks for SQL setup.',
        extraInstruction ?? '',
      ]
        .filter(Boolean)
        .join(' '),
      input: [
        `학습 계획 제목: ${planTitle}`,
        `전체 목표: ${goalText}`,
        `선택 코스: ${selectedCourseName}`,
        `현재 일차: ${studyDay.dayNumber}일차`,
        `오늘 목차: ${studyDay.title}`,
        `오늘 내용 요약: ${studyDay.topicSummary}`,
        `오늘 학습 목표: ${studyDay.learningGoal}`,
        `오늘 학습 범위: ${studyDay.scopeText}`,
        '위 정보를 바탕으로 학습 스레드 내용, 문제 10개, 각 문제당 힌트 3개, 예상 답안 및 해설을 생성해주세요.',
        '학습 내용은 최소 45~60분 정도 학습할 수 있을 만큼 충분히 자세해야 하며, 단순 정의 나열이 아니라 실제 이해를 돕는 밀도가 있어야 합니다.',
        '설명은 요약형이 아니라 용어 설명, 개념 간 관계, 동작 원리, 예시, 비교, 주의점, 자주 하는 실수, 간단한 자기점검 요소까지 포함된 상세 설명이어야 합니다.',
        '특히 오늘 배우는 개념이 실제 데이터베이스 설계나 조회, 데이터 관리에서 왜 중요한지도 초보자 눈높이로 풀어서 설명해주세요.',
        '오늘 설명에는 최소 2개의 구체적인 예시나 작은 사례를 포함해주세요. 단순 정의 반복은 줄이고, 실제로 테이블을 어떻게 읽는지, 왜 그렇게 설계하는지, 어디서 실수하는지를 보여주세요.',
        '개념 위주의 날이라도 표나 간단한 테이블 예시, 실제 업무 상황 예시, 데이터 한 줄이 의미하는 바 같은 구체 장면을 넣어주세요.',
        '개념을 설명만 하지 말고, 실제 서비스에서 어떤 데이터에 쓰이는지와 그 데이터를 사람이 어떻게 읽고 해석하는지 바로 이어서 보여주세요.',
        '회원, 주문, 상품, 게시글, 출결, 성적 같은 익숙한 데이터 예시를 우선 사용해서 설명해주세요.',
        '최소 한 번은 간단한 샘플 행이나 미니 테이블을 보여주고, 그 데이터가 무엇을 의미하는지 해석해주세요.',
        '최소 한 번은 개념을 잘못 이해했을 때 실무에서 어떤 문제가 생기는지 예시로 설명해주세요.',
        '반드시 자주 하는 실수 문단 하나와 스스로 점검해보는 문단 하나를 명확히 포함해주세요.',
        '본문은 6~10개의 짧은 문단으로 나누고 문단 사이에 빈 줄을 넣어 가독성을 높여주세요.',
        '각 문단은 너무 길지 않게 유지하고, 하나의 긴 벽문장처럼 쓰지 마세요.',
        'SQL 문법이나 예시 쿼리가 나오면 본문 중간에 그냥 문장처럼 섞지 말고 반드시 ```sql 코드블록```으로 감싸주세요.',
        '설명 문단과 SQL 예시 블록 사이도 빈 줄로 구분해서 한눈에 읽히게 해주세요.',
        '가능하면 개념 소개 -> 핵심 용어 정의 -> 비교/구조 설명 -> 실무 예시 -> 자주 하는 실수 -> 짧은 점검/정리 흐름으로 전개해주세요.',
        '같은 뜻의 문장을 반복하며 분량만 늘리지 말고, 각 문단이 새로운 이해를 추가하도록 써주세요.',
        '설명 중 필요한 경우 마크다운 표를 만들어 비교하거나 정리해주세요.',
        '마크다운 표는 항상 코드 블록 안에 넣어주세요.',
        '문제는 반드시 오늘 학습한 내용만으로 풀 수 있는 수준으로 만들어주세요.',
        'SQL 쿼리를 함께 배우는 날이라면 문제 비율은 SQL 문제 6~8개, 지식 확인 문제 2~4개로 맞춰주세요.',
        '문제에서 테이블이나 예시 데이터를 가정한다면 quizIntroText 상단에 [공통 실습 SQL] 안내를 두고, [테이블 생성 SQL]과 [예제 데이터 INSERT SQL]을 각각 ```sql 코드블록```으로 한 번만 넣어주세요.',
        '각 SQL 문제는 그 공통 실습 SQL을 먼저 실행했다고 가정하고 문제만 제시해주세요.',
      ].join('\n\n'),
    };
  }

  // Builds the OpenAI request used to generate level-based DB study direction options.
  // 난이도별 DB 학습 방향성 옵션 생성을 위한 OpenAI 요청을 구성한다.
  private buildStudyDirectionRequest(days: number, extraInstruction?: string) {
    return {
      model: this.openAiClientService.model,
      instructions: [
        'You are generating a DB study plan draft.',
        'Answer in Korean.',
        'Be concise, structured, and practical.',
        'Do not include greetings, encouragement, wrap-up text, or follow-up questions.',
        'Do not say things like "무엇을 더 도와드릴까요", "원하시면", or similar closing phrases.',
        'Output only the study direction content itself.',
        'Generate three separate level-direction options: beginner, intermediate, and advanced.',
        'These are alternative options to choose from, not sequential stages.',
        'Use these exact headings once each: [입문자 코스], [중급자 코스], [상급자 코스].',
        'For each course, include the following block after the heading: 권장 학습 가이드 / 핵심 요약만 학습: ... / 자세하게 학습: ...',
        'For the advanced course, add one caution line that says the learner may need a longer period to reach real proficiency.',
        'Under each course heading, repeat this exact item format: 목차 (일정) on one line, then 핵심 내용 2~3줄 on the next lines.',
        'If the study duration is long, the beginner course may extend slightly into intermediate topics, and the intermediate course may extend slightly into advanced topics.',
        'Still keep the main identity of each course aligned with its chosen level.',
        `The schedule coverage inside each course must end exactly on day ${days}.`,
        `Use only N일차 or A~B일차 format for schedules, and the final scheduled day must be ${days}일차.`,
        'Do not omit 일정.',
        extraInstruction ?? '',
      ]
        .filter(Boolean)
        .join(' '),
      input: `DB를 ${days}일 학습하려고 합니다. 입문자 코스, 중급자 코스, 상급자 코스를 각각 별개의 선택지로 나눠서 만들어주세요. 세 코스는 순차 진행용이 아니라 셋 중 하나를 선택할 수 있는 대안이어야 합니다. 반드시 [입문자 코스], [중급자 코스], [상급자 코스] 제목을 사용해주세요. 각 코스마다 아래 권장 학습 가이드를 그대로 반영해주세요. 입문자: 핵심 요약만 학습 5~7일, 자세하게 학습 7일 이상. 중급자: 핵심 요약만 학습 10~14일, 자세하게 학습 14일 이상. 상급자: 핵심 요약만 학습 20~30일, 자세하게 학습 30일 이상, 실제 숙련까지는 더 긴 기간이 필요할 수 있음. 각 코스는 여러 학습 항목으로 구성하고, 각 항목마다 "목차 (일정)" 한 줄과 그 아래 "핵심 내용 2~3줄" 형식을 반복해주세요. 일정은 정확히 ${days}일 분량으로 맞춰주세요. 즉 각 코스의 마지막 일정은 반드시 ${days}일차여야 합니다. 다만 기간이 길면 입문자 코스는 중급자 초입까지, 중급자 코스는 상급자 초입까지 일부 자연스럽게 확장해도 됩니다.`,
    };
  }

  // Checks whether the generated schedules reach the exact final day requested by the user.
  // 생성된 일정이 사용자가 요청한 마지막 일차까지 정확히 도달하는지 검사한다.
  private hasExactDayCoverage(content: string, days: number) {
    const scheduleMatches = [
      ...content.matchAll(/(\d+)\s*~\s*(\d+)일차/g),
      ...content.matchAll(/(\d+)일차/g),
    ];

    if (scheduleMatches.length === 0) {
      return false;
    }

    let maxDay = 0;

    for (const scheduleMatch of scheduleMatches) {
      const endDay = scheduleMatch[2] ? Number(scheduleMatch[2]) : Number(scheduleMatch[1]);

      if (endDay > maxDay) {
        maxDay = endDay;
      }
    }

    return maxDay === days;
  }

  // Parses the JSON response used for the detailed study plan.
  // 상세 학습 계획용 JSON 응답을 파싱한다.
  private parseDetailedStudyPlan(content: string, expectedDays: number): GeneratedStudyPlan {
    const parsedContent = this.parseJsonObject<GeneratedStudyPlan>(content) as GeneratedStudyPlan;

    if (!Array.isArray(parsedContent.days) || parsedContent.days.length !== expectedDays) {
      throw new Error(`상세 학습 계획에는 정확히 ${expectedDays}일치 일정이 있어야 합니다.`);
    }

    return parsedContent;
  }

  // Parses the JSON response used for one day of study materials.
  // 하루치 학습 자료 생성용 JSON 응답을 파싱한다.
  private parseStudyDayMaterials(content: string): GeneratedStudyDayMaterials {
    const parsedContent = this.parseJsonObject<GeneratedStudyDayMaterials>(
      content,
    ) as GeneratedStudyDayMaterials;

    if (!Array.isArray(parsedContent.quizItems) || parsedContent.quizItems.length !== 10) {
      throw new Error('하루치 학습 자료에는 문제 10개가 정확히 포함되어야 합니다.');
    }

    if (!parsedContent.contentText?.trim() || parsedContent.contentText.trim().length < 1600) {
      throw new Error('하루치 학습 설명이 너무 짧아 충분한 분량으로 생성되지 않았습니다.');
    }

    const contentParagraphs = parsedContent.contentText
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (contentParagraphs.length < 6) {
      throw new Error('하루치 학습 설명 문단 수가 부족합니다.');
    }

    const exampleMarkerMatches = parsedContent.contentText.match(/예를 들어|예시|가령/g) ?? [];

    if (exampleMarkerMatches.length < 2) {
      throw new Error('하루치 학습 설명에 구체 예시가 부족합니다.');
    }

    parsedContent.quizItems = parsedContent.quizItems.map((quizItem) => {
      const normalizedHintTexts = this.normalizeQuizHintTexts(quizItem.hintTexts);

      if (!quizItem.modelAnswerText?.trim()) {
        throw new Error('모든 문제에는 모범 답안이 포함되어야 합니다.');
      }

      if (!quizItem.explanationText?.trim()) {
        throw new Error('모든 문제에는 해설이 포함되어야 합니다.');
      }

      return {
        ...quizItem,
        hintTexts: normalizedHintTexts,
      };
    });

    return parsedContent;
  }

  // Normalizes generated hint arrays so every quiz item ends up with exactly three hints.
  // 생성된 힌트 배열을 보정해서 모든 문제에 힌트 3개가 들어가도록 맞춘다.
  private normalizeQuizHintTexts(hintTexts: string[]) {
    if (!Array.isArray(hintTexts)) {
      throw new Error('모든 문제에는 힌트 배열이 포함되어야 합니다.');
    }

    const trimmedHintTexts = hintTexts.map((hintText) => String(hintText).trim()).filter(Boolean);

    if (trimmedHintTexts.length === 0) {
      throw new Error('모든 문제에는 최소 1개 이상의 힌트가 포함되어야 합니다.');
    }

    while (trimmedHintTexts.length < 3) {
      trimmedHintTexts.push(trimmedHintTexts[trimmedHintTexts.length - 1]);
    }

    return trimmedHintTexts.slice(0, 3);
  }

  // Parses JSON more defensively by stripping fences, extracting the object range, and fixing trailing commas.
  // 코드블록 제거, 객체 범위 추출, 후행 쉼표 보정을 거치며 JSON 파싱을 최대한 복구한다.
  private parseJsonObject<T>(content: string) {
    const candidateContents = this.buildJsonCandidates(content);
    let lastError: unknown;

    for (const candidateContent of candidateContents) {
      try {
        return JSON.parse(candidateContent) as T;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`LLM JSON 파싱 실패: ${this.getErrorMessage(lastError)}`);
  }

  // Builds several JSON parse candidates from the raw LLM output.
  // 원본 LLM 응답에서 여러 JSON 파싱 후보 문자열을 만들어 본다.
  private buildJsonCandidates(content: string) {
    const trimmedContent = content.trim();
    const unfencedContent = trimmedContent.replace(/^```json\s*|^```\s*|\s*```$/g, '').trim();
    const extractedJsonContent = this.extractJsonObjectBlock(unfencedContent);
    const candidateContents = [
      trimmedContent,
      unfencedContent,
      this.removeTrailingJsonCommas(trimmedContent),
      this.removeTrailingJsonCommas(unfencedContent),
      extractedJsonContent,
      this.removeTrailingJsonCommas(extractedJsonContent),
    ]
      .map((candidateContent) => candidateContent.trim())
      .filter(Boolean);

    return Array.from(new Set(candidateContents));
  }

  // Extracts the substring between the first opening and last closing JSON braces.
  // 첫 여는 중괄호와 마지막 닫는 중괄호 사이만 잘라 JSON 본문 후보를 추출한다.
  private extractJsonObjectBlock(content: string) {
    const firstBraceIndex = content.indexOf('{');
    const lastBraceIndex = content.lastIndexOf('}');

    if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
      return content;
    }

    return content.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  // Removes trailing commas that commonly break JSON parsing.
  // JSON 파싱을 깨뜨리는 흔한 후행 쉼표를 제거한다.
  private removeTrailingJsonCommas(content: string) {
    return content.replace(/,\s*([}\]])/g, '$1');
  }

  // Normalizes an unknown error into a short readable message.
  // 알 수 없는 에러 값을 짧고 읽기 쉬운 문자열로 정리한다.
  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error ?? '알 수 없는 오류');
  }
}
