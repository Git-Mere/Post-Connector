import 'dotenv/config';
import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true }));

// TODO 라우트:
//   POST /projects        repo URL 입력 → GitHub 데이터 수집
//   POST /projects/:id/enrichment   사용자 보강 입력 저장
//   POST /generate        선택한 어댑터들로 콘텐츠 생성 (병렬)
//   POST /publish/:adapterId        자동 어댑터 발행 큐 enqueue
//   GET  /adapters        등록된 어댑터 목록

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
