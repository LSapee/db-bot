export type StudyCourseName = '입문자' | '중급자' | '상급자';

export type PlanCreationMode = 'PARALLEL' | 'REPLACE';

export type DurationInputState = {
  stage: 'AWAITING_DURATION_INPUT';
};

export type ExistingPlanDecisionState = {
  stage: 'AWAITING_EXISTING_PLAN_DECISION';
  pendingDays: number;
  activePlans: Array<{
    id: string;
    summaryLine: string;
  }>;
};

export type CourseSelectionState = {
  stage: 'AWAITING_COURSE_SELECTION';
  totalDays: number;
  creationMode: PlanCreationMode;
  activePlanIdsToCancel: string[];
  courseSelectionSummaryText: string;
};

export type CourseConfirmationState = {
  stage: 'AWAITING_COURSE_CONFIRMATION';
  totalDays: number;
  creationMode: PlanCreationMode;
  activePlanIdsToCancel: string[];
  previewTemplateId: string;
  selectedCourseName: StudyCourseName;
  selectedCourseContent: string;
};

export type StartSelectionState = {
  stage: 'AWAITING_START';
  totalDays: number;
  creationMode: PlanCreationMode;
  activePlanIdsToCancel: string[];
  previewTemplateId: string;
  planTemplateId: string;
  selectedCourseName: StudyCourseName;
  selectedCourseContent: string;
  generatedStudyPlan: {
    planTitle: string;
    goalText: string;
    days: Array<{
      dayNumber: number;
      title: string;
      topicSummary: string;
      learningGoal: string;
      scopeText: string;
    }>;
  };
};

export type StudyPlanConversationState =
  | DurationInputState
  | ExistingPlanDecisionState
  | CourseSelectionState
  | CourseConfirmationState
  | StartSelectionState;

export type StudyPlanListOverlayState = {
  listType: 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  previousState: StudyPlanConversationState | null;
};
