import fs from 'fs';
import path from 'path';

interface QuestionResult {
  question_id: number;
  question: string;
  expected_answer: string;
  our_answer: string;
  score: number;
  reasoning: string;
}

interface EvalResults {
  sample_id: string;
  results: QuestionResult[];
}

function extractIncorrectAnswers(inputFile: string, outputFile: string) {
  // Read the evaluation results
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8')) as EvalResults;

  // Filter for incorrect answers (score < 1)
  const incorrectAnswers = data.results.filter(result => result.score < 1);

  // Generate markdown
  let markdown = `# Incorrect Answers - ${data.sample_id}\n\n`;
  markdown += `Total incorrect: ${incorrectAnswers.length} / ${data.results.length}\n\n`;
  markdown += `---\n\n`;

  incorrectAnswers.forEach((result, index) => {
    markdown += `## Question ${result.question_id + 1} (Score: ${result.score})\n\n`;
    markdown += `**Question:** ${result.question}\n\n`;
    markdown += `**Expected Answer:** ${result.expected_answer}\n\n`;
    markdown += `**Our Answer:** ${result.our_answer}\n\n`;
    markdown += `**Reasoning:** ${result.reasoning}\n\n`;
    markdown += `---\n\n`;
  });

  // Write to output file
  fs.writeFileSync(outputFile, markdown);
  console.log(`✅ Extracted ${incorrectAnswers.length} incorrect answers to ${outputFile}`);
}

// Get input and output files from command line arguments
const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace('.json', '-incorrect.md');

if (!inputFile) {
  console.error('Usage: tsx extract-incorrect-answers.ts <input-file.json> [output-file.md]');
  process.exit(1);
}

extractIncorrectAnswers(inputFile, outputFile);
