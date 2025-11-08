# Saturn Backend

Express TypeScript backend API for Cosmo AI Companion.

## Prerequisites

- Node.js >= 20.0.0
- npm or yarn

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration values.

## Development

Run the development server with hot reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the PORT specified in your `.env` file).

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run type-check` - Type check without emitting files

## Project Structure

```
backend/
├── src/
│   └── index.ts          # Main server entry point
├── dist/                 # Compiled output (generated)
├── .env.example          # Environment variables template
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies and scripts
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api` - API info endpoint

## Tech Stack

- **Express** - Web framework
- **TypeScript** - Type safety
- **Helmet** - Security headers
- **CORS** - Cross-origin resource sharing
- **Morgan** - HTTP request logger


## Neo4j Integration

docker run \
--name neo4j \
-p 7474:7474 -p 7687:7687 \
-e NEO4J_AUTH=neo4j/your_password_here \
-d neo4j:latest