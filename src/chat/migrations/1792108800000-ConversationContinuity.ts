import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationContinuity1792108800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
CREATE TABLE chat_conversations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 client_request_id uuid NOT NULL,
 list_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 title varchar(80) NOT NULL DEFAULT 'New conversation',
 created_at bigint NOT NULL, updated_at bigint NOT NULL,
 next_turn integer NOT NULL DEFAULT 1 CHECK(next_turn > 0 AND next_turn < 1000000000),
 FOREIGN KEY(tenant_id,owner_user_id) REFERENCES identity_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,owner_user_id,client_request_id)
);
CREATE INDEX chat_conversations_owner_page ON chat_conversations(tenant_id,owner_user_id,list_order DESC);
CREATE TABLE chat_turns (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES chat_conversations(id),
 client_request_id uuid NOT NULL, turn_order integer NOT NULL CHECK(turn_order>0),
 payload_hash char(64) NOT NULL, attempt_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','completed','failed','outcome_unknown')),
 started_at bigint NOT NULL, deadline_at bigint NOT NULL, completed_at bigint,
 error_code varchar(64), context_message_ids uuid[] NOT NULL,
 provider varchar(32), model varchar(120), latency_ms integer CHECK(latency_ms>=0), usage jsonb,
 UNIQUE(conversation_id,client_request_id), UNIQUE(conversation_id,turn_order), UNIQUE(id,conversation_id),
 CHECK(deadline_at>started_at), CHECK((status='pending')=(completed_at IS NULL)),
 CHECK((status IN ('failed','outcome_unknown'))=(error_code IS NOT NULL))
);
CREATE UNIQUE INDEX chat_one_pending ON chat_turns(conversation_id) WHERE status='pending';
CREATE TABLE chat_messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL, turn_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')),
 text text NOT NULL CHECK(length(text)>0 AND length(text)<=16000),
 message_order integer NOT NULL CHECK(message_order>0), created_at bigint NOT NULL,
 FOREIGN KEY(turn_id,conversation_id) REFERENCES chat_turns(id,conversation_id),
 UNIQUE(turn_id,role), UNIQUE(conversation_id,message_order)
);
CREATE INDEX chat_messages_page ON chat_messages(conversation_id,message_order DESC);
`);
  }
  async down(): Promise<void> {
    throw new Error('CHAT_DATA_DELETION_REQUIRES_OPERATOR_PLAN');
  }
}
