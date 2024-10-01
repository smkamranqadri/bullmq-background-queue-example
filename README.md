# Background Task using Queue

Example of using BullMQ and @bull-board with Redis for background task using queue

```
make dev
```

above commond will start a docker compose app with redis and nodejs

```
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"email": "jane.doe1@example.com"}'
```

```
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email": "jane.doe1@example.com"}'
```

Run above commond on terminal to observe the background task running