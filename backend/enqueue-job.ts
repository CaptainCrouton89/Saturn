/**
 * Manual script to enqueue a conversation for memory extraction
 * Usage: tsx enqueue-job.ts <conversationId>
 */

import 'dotenv/config';
import { enqueueConversationProcessing } from './src/queue/memoryQueue.js';
import { supabaseService } from './src/db/supabase.js';

async function main() {
  const conversationId = process.argv[2];

  if (!conversationId) {
    console.error('❌ Usage: tsx enqueue-job.ts <conversationId>');
    process.exit(1);
  }

  try {
    // Fetch conversation to get user_id
    const client = supabaseService.getClient();
    const { data: conversation, error } = await client
      .from('conversation')
      .select('id, user_id, status, entities_extracted')
      .eq('id', conversationId)
      .single();

    if (error || !conversation) {
      console.error(`❌ Conversation ${conversationId} not found`);
      process.exit(1);
    }

    console.log(`📋 Conversation: ${conversation.id}`);
    console.log(`   User: ${conversation.user_id}`);
    console.log(`   Status: ${conversation.status}`);
    console.log(`   Entities Extracted: ${conversation.entities_extracted}`);

    // Enqueue the job
    const jobId = await enqueueConversationProcessing(
      conversation.id,
      conversation.user_id
    );

    console.log(`✅ Job enqueued successfully!`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`\nYour local worker should pick this up shortly...`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to enqueue job:', error);
    process.exit(1);
  }
}

main();
