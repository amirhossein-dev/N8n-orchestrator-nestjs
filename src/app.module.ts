import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';
import { MemoryModule } from './memory/memory.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { IdentityModule } from './identity/identity.module';
import { dbConnection } from './identity/db-options';

const developmentSync = process.env.DB_SYNCHRONIZE === 'true';
if (developmentSync && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  throw new Error('DB_SYNCHRONIZE is permitted only for disposable development databases.');
}
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dbConnection(),
      entities: [User],
      autoLoadEntities: true,
      synchronize: developmentSync,
      migrationsRun: false,
    }),
    IdentityModule,
    UsersModule,
    MemoryModule,
    OrchestratorModule,
  ],
})
export class AppModule {}
