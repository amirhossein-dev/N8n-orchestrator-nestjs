import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('conversation_messages')
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  conversationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  role!: 'user' | 'assistant' | 'tool';

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  correlationId?: string;

  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}
