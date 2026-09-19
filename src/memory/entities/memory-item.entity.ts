import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('memory_items')
export class MemoryItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  conversationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  type!: 'note' | 'task' | 'fact' | 'link';

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  tags?: string[];

  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}
