import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('tool_executions')
export class ToolExecution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  conversationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  correlationId!: string;

  @Column({ type: 'varchar', length: 128 })
  toolName!: string;

  @Column({ type: 'jsonb' })
  args!: Record<string, any>;

  @Column({ type: 'boolean' })
  ok!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  data?: any;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
