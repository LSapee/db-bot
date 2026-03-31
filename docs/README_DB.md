# DB Guide

현재 프로젝트의 실제 DB 구조를 빠르게 파악하기 위한 문서다.  
정확한 최종 기준은 언제나 `prisma/schema.prisma` 이다.

## 한눈에 보는 구조

```text
discord_users
  └─ discord_members
       └─ study_plans
            └─ study_days
                 ├─ day_contents
                 ├─ quizzes
                 │    └─ quiz_items
                 │         ├─ quiz_hints
                 │         └─ submissions
                 ├─ lesson_questions
                 │    └─ lesson_answers
                 └─ study_day_material_jobs

discord_guilds
  ├─ discord_members
  └─ study_plans

study_course_preview_templates
  └─ study_plan_templates
       └─ study_day_material_templates
```

## 현재 핵심 흐름

- Discord 서버 하나를 하나의 학습 그룹으로 본다.
- 서버장이 `db_study_plan` 채널에서 기간과 코스를 선택하면 실행 플랜이 만들어진다.
- 실행 플랜은 `study_plans -> study_days`로 저장된다.
- 실제 게시된 학습 본문은 `day_contents`, 문제는 `quizzes -> quiz_items -> quiz_hints`에 저장된다.
- 질문은 `lesson_questions -> lesson_answers`, 제출은 `submissions`에 저장된다.
- 템플릿 재사용은 `study_course_preview_templates`, `study_plan_templates`, `study_day_material_templates`가 담당한다.
- 후속 일차 자료 생성 상태는 `study_day_material_jobs`가 추적한다.

## 1. Discord 식별 계층

### `discord_users`

Discord 전역 사용자 기준 테이블이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `discord_user_id` | Discord 사용자 ID, 전역 unique |
| `username` | 최근 username |
| `created_at`, `updated_at` | 생성/수정 시각 |

관계:

- `discord_members`
- `discord_guilds.owner_discord_user_uuid`
- `course_generation_usages`

### `discord_guilds`

Discord 서버 기준 테이블이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `discord_guild_id` | Discord 서버 ID, unique |
| `name` | 서버 이름 |
| `owner_discord_user_id` | Discord 서버장 ID 문자열 |
| `owner_discord_user_uuid` | `discord_users` 참조 |
| `timezone` | 서버 기준 시간대, 기본값 `Asia/Seoul` |
| `main_channel_id` | 메인 채널 ID |
| `quiz_channel_id` | 퀴즈 채널 ID |
| `answer_channel_id` | 답변 채널 ID |
| `created_at`, `updated_at` | 생성/수정 시각 |

관계:

- `discord_members`
- `study_plans`

### `discord_members`

서버 안에서의 사용자 membership 기록이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `guild_uuid` | 소속 서버 |
| `discord_user_id` | Discord 사용자 ID |
| `discord_user_uuid` | `discord_users` 참조 |
| `username` | 최근 username |
| `display_name` | 서버 내 표시 이름 |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(guild_uuid, discord_user_id)` unique

관계:

- `study_plans.creator_member_uuid`
- `lesson_questions.member_uuid`
- `submissions.member_uuid`

## 2. 학습 실행 계층

### `study_plans`

실제 학습 실행 단위다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `guild_uuid` | 소속 서버 |
| `creator_member_uuid` | 계획 생성 멤버 |
| `goal_text` | 전체 학습 목표 |
| `requested_range_text` | 사용자가 선택한 코스/범위 텍스트 |
| `total_days` | 총 학습 일수 |
| `start_date` | 시작일 |
| `current_day` | 현재 진행 일차 |
| `next_publish_at` | 다음 자동 게시 시각 |
| `status` | `DRAFT`, `READY`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `ARCHIVED` |
| `outline_raw` | 코스 미리보기 원본 |
| `plan_raw` | 상세 계획 원본 |
| `created_at`, `updated_at` | 생성/수정 시각 |

운영 메모:

- `current_day = 0`은 아직 1일차 게시 전 상태로도 사용된다.
- 시작 직후 게시 실패 시 `CANCELLED`로 내려가고 재개 흐름으로 복구한다.
- 자동 진행 기준 시각은 `next_publish_at`이다.

### `study_days`

실행 플랜의 일차별 레코드다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_plan_uuid` | 소속 플랜 |
| `day_number` | N일차 |
| `title` | 일차 제목 |
| `topic_summary` | 핵심 주제 요약 |
| `learning_goal` | 학습 목표 |
| `scope_text` | 학습 범위 설명 |
| `status` | `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED` |
| `scheduled_date` | 해당 일차의 실제 날짜 |
| `user_answer_thread_id` | 제출 스레드 Discord ID, unique |
| `user_ask_thread_id` | 질문 스레드 Discord ID, unique |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(study_plan_uuid, day_number)` unique

관계:

- `day_contents`
- `quizzes`
- `lesson_questions`
- `study_day_material_jobs`

### `day_contents`

하루 학습 본문을 저장한다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_day_uuid` | 대상 `study_days`, unique |
| `discord_message_id` | `db_tutor` starter message ID |
| `summary_text` | 짧은 요약 |
| `content_text` | 본문 |
| `llm_raw` | 생성 원본 JSON |
| `published_at` | 게시 시각 |
| `created_at`, `updated_at` | 생성/수정 시각 |

### `quizzes`

하루 퀴즈 묶음 단위다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_day_uuid` | 대상 `study_days`, unique |
| `discord_message_id` | `db_quiz` starter message ID |
| `intro_text` | 문제 안내문 |
| `published_at` | 게시 시각 |
| `created_at`, `updated_at` | 생성/수정 시각 |

### `quiz_items`

개별 문제 단위다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `quiz_uuid` | 소속 퀴즈 |
| `question_no` | 문제 번호 |
| `prompt_text` | 문제 본문 |
| `expected_points` | 내부 채점 비교 포인트 JSON |
| `model_answer_text` | 모범 답안 |
| `explanation_text` | 해설 |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(quiz_uuid, question_no)` unique

### `quiz_hints`

문제별 힌트다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `quiz_item_uuid` | 대상 문제 |
| `hint_no` | 힌트 번호 |
| `hint_text` | 힌트 본문 |
| `llm_raw` | 생성 원본 JSON |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(quiz_item_uuid, hint_no)` unique

## 3. 질문 / 제출 계층

### `lesson_questions`

학습 질문 원문이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_day_uuid` | 관련 일차 |
| `member_uuid` | 질문한 멤버 |
| `discord_channel_id` | 질문 스레드 ID |
| `discord_message_id` | 질문 메시지 ID |
| `question_text` | 질문 본문 |
| `normalized_text` | 재사용 탐색용 정규화 문장 |
| `status` | `PENDING`, `ANSWERED`, `REUSED` |
| `created_at`, `updated_at` | 생성/수정 시각 |

### `lesson_answers`

질문에 대한 답변이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `question_uuid` | 대상 질문 |
| `answer_text` | 답변 본문 |
| `answer_source_type` | `GENERATED`, `REUSED` |
| `source_question_uuid` | 재사용한 원본 질문 |
| `discord_message_id` | Discord 답변 메시지 ID |
| `llm_raw` | 생성 원본 JSON |
| `created_at`, `updated_at` | 생성/수정 시각 |

관계:

- 하나의 질문은 여러 답변 이력을 가질 수 있다.
- 재사용 답변이면 `source_question_uuid`가 원본 질문을 가리킨다.

### `submissions`

문제 제출 기록이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `quiz_item_uuid` | 제출 대상 문제 |
| `member_uuid` | 제출한 멤버 |
| `discord_message_id` | 제출 메시지 ID |
| `answer_text` | 제출 SQL/답안 |
| `status` | `SUBMITTED`, `RESPONDED` |
| `created_at`, `updated_at` | 생성/수정 시각 |

## 4. 템플릿 / 재사용 계층

### `study_course_preview_templates`

같은 일수와 코스 조합에 대한 코스 미리보기 캐시다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `total_days` | 총 일수 |
| `course_name` | 코스명 |
| `prompt_version` | 프롬프트 버전 |
| `content_text` | 미리보기 본문 |
| `usage_count` | 재사용 횟수 |
| `created_at`, `updated_at` | 생성/수정 시각 |

### `study_plan_templates`

코스 미리보기에서 이어지는 상세 일정 템플릿이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `course_preview_template_uuid` | 소속 미리보기 템플릿 |
| `prompt_version` | 프롬프트 버전 |
| `plan_title` | 계획 제목 |
| `goal_text` | 전체 목표 |
| `plan_raw` | 상세 일정 JSON 원본 |
| `usage_count` | 재사용 횟수 |
| `created_at`, `updated_at` | 생성/수정 시각 |

### `study_day_material_templates`

상세 일정 템플릿의 일차 자료 캐시다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_plan_template_uuid` | 소속 상세 일정 템플릿 |
| `day_number` | 일차 번호 |
| `materials_raw` | 튜터 본문, 문제, 힌트, 정답을 담은 JSON |
| `usage_count` | 재사용 횟수 |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(study_plan_template_uuid, day_number)` unique

운영 메모:

- 템플릿 계층은 대부분 JSON 중심 저장이다.
- 실행 계층은 `day_contents`, `quizzes`, `quiz_items`, `quiz_hints`로 정규화된다.

## 5. 운영 / 추적 계층

### `study_day_material_jobs`

후속 일차 자료 생성 작업 큐다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `study_plan_uuid` | 소속 실행 플랜 |
| `study_day_uuid` | 대상 일차, unique |
| `study_day_number` | 조회 편의용 일차 번호 |
| `generation_mode` | 생성 방식 메모 |
| `batch_id` | Batch API 추적용 |
| `batch_status` | Batch 상태 |
| `requested_at` | 생성 요청 시각 |
| `deadline_at` | 처리 마감 시각 |
| `ready_at` | 자료 준비 완료 시각 |
| `fallback_attempted_at` | fallback 시도 시각 |
| `status` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `attempt_count` | 재시도 횟수 |
| `last_error_text` | 마지막 오류 |
| `last_attempted_at` | 마지막 시도 시각 |
| `completed_at` | 완료 시각 |
| `created_at`, `updated_at` | 생성/수정 시각 |

운영 메모:

- 현재는 후속 일차 선생성 추적에 사용된다.
- 일부 Batch 관련 컬럼은 미래 확장 대비 성격이 강하다.

### `course_generation_usages`

코스 생성 사용량 집계 테이블이다.

| 컬럼 | 설명 |
| --- | --- |
| `id` | 내부 UUID PK |
| `discord_user_uuid` | 대상 사용자 |
| `usage_date` | 집계 날짜 |
| `usage_type` | `COURSE_PREVIEW`, `DETAILED_PLAN` |
| `request_count` | 당일 호출 횟수 |
| `created_at`, `updated_at` | 생성/수정 시각 |

핵심 제약:

- `(discord_user_uuid, usage_date, usage_type)` unique

## 상태값 정리

### `plan_status`

- `DRAFT`: 초안 단계
- `READY`: 시작 직전 준비 완료
- `ACTIVE`: 진행 중
- `COMPLETED`: 정상 완료
- `CANCELLED`: 중단
- `ARCHIVED`: 중도 종료 보관 상태

### `day_status`

- `PENDING`
- `IN_PROGRESS`
- `COMPLETED`
- `SKIPPED`

### `material_job_status`

- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

### `lesson_question_status`

- `PENDING`
- `ANSWERED`
- `REUSED`

### `submission_status`

- `SUBMITTED`
- `RESPONDED`

### `answer_source_type`

- `GENERATED`
- `REUSED`

### `course_generation_usage_type`

- `COURSE_PREVIEW`
- `DETAILED_PLAN`

## 운영 메모

- `db_study_plan` 입력은 실제 Discord 서버장 기준으로만 허용된다.
- `study_days.user_answer_thread_id`, `study_days.user_ask_thread_id` 에 Discord thread ID를 직접 저장한다.
- 일부 게시가 실패하면 이미 만든 Discord 스레드를 롤백 삭제하고 플랜 상태를 조정한다.
- 자동 게시 중복 방지는 DB advisory lock 기반으로 처리한다.
- 서버 삭제나 봇 추방으로 고아 플랜이 생기면 `CANCELLED`로 정리한다.

## 문서 범위

- 이 문서는 "왜 이 테이블이 있는지"와 "실제 운영에서 어떻게 연결되는지" 중심이다.
- 전체 컬럼 타입, FK 옵션, index 이름까지 필요하면 `prisma/schema.prisma`를 직접 본다.
