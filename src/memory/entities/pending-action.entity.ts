import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('pending_actions')
export class PendingAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  conversationId!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: 'pending' | 'approved' | 'rejected';

  @Column({ type: 'jsonb' })
  toolCall!: { name: string; args: Record<string, any> };

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
