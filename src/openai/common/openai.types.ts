export type GeneratedStudyPlanDay = {
  dayNumber: number;
  title: string;
  topicSummary: string;
  learningGoal: string;
  scopeText: string;
};

export type GeneratedStudyPlan = {
  planTitle: string;
  goalText: string;
  days: GeneratedStudyPlanDay[];
};

export type GeneratedQuizItem = {
  questionNo: number;
  promptText: string;
  expectedPoints: string[];
  hintTexts: string[];
  modelAnswerText: string;
  explanationText: string;
};

export type GeneratedStudyDayMaterials = {
  summaryText: string;
  contentText: string;
  quizIntroText: string;
  quizItems: GeneratedQuizItem[];
};

export type GeneratedStudyQuestionAnswer = {
  canAnswer: boolean;
  answerText: string;
};
