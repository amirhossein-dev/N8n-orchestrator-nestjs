import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';
import { MemoryModule } from './memory/memory.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
// import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'myuser',
      password: 'mypass',
      database: 'mydb',
      entities: [User],
      synchronize: true, // dev mode
      autoLoadEntities: true,
    }),
    UsersModule,
    MemoryModule,
    OrchestratorModule,
  ],
})
export class AppModule {}
