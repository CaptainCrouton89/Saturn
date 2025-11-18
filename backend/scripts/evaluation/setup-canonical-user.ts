/**
 * Setup Canonical Evaluation User
 *
 * Creates a single canonical user for LoCoMo evaluation:
 * 1. Creates Supabase auth user with deterministic credentials
 * 2. Creates user_profiles entry
 * 3. Creates owner Person node in Neo4j
 *
 * This user will be shared across all LoCoMo dialogues for proper semantic consolidation.
 *
 * Usage:
 *   pnpm tsx scripts/evaluation/setup-canonical-user.ts
 *   pnpm tsx scripts/evaluation/setup-canonical-user.ts --user-id custom-eval-user --display-name "Custom Eval"
 */

import 'dotenv/config';
import { neo4jService } from '../../src/db/neo4j.js';
import { supabaseService } from '../../src/db/supabase.js';
import { personRepository } from '../../src/repositories/PersonRepository.js';
import { authService } from '../../src/services/authService.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_USER_ID = 'locomo-eval-user';
const DEFAULT_DISPLAY_NAME = 'LoCoMo Evaluation User';
const DEFAULT_DEVICE_ID = 'locomo-eval-device-canonical';

interface SetupConfig {
  userId?: string;
  displayName?: string;
  deviceId?: string;
}

// ============================================================================
// Main Setup Function
// ============================================================================

async function setupCanonicalUser(config: SetupConfig = {}) {
  const deviceId = config.deviceId ?? DEFAULT_DEVICE_ID;
  const displayName = config.displayName ?? DEFAULT_DISPLAY_NAME;
  const expectedUserId = config.userId ?? DEFAULT_USER_ID;

  console.log('🚀 Setting up canonical evaluation user\n');
  console.log('Configuration:');
  console.log(`  Device ID: ${deviceId}`);
  console.log(`  Display Name: ${displayName}`);
  console.log(`  Expected User ID: ${expectedUserId}`);
  console.log('');

  try {
    // Initialize Neo4j connection
    console.log('🔌 Connecting to Neo4j...');
    await neo4jService.connect();
    console.log('✅ Connected to Neo4j\n');
    // Step 1: Check if device already exists
    console.log('📋 Checking for existing device...');
    const { data: existingProfile, error: profileError } = await supabaseService.getClient()
      .from('user_profiles')
      .select('id, device_id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (profileError) {
      throw new Error(`Failed to check existing profile: ${profileError.message}`);
    }

    if (existingProfile) {
      console.log(`✅ Device already exists with user_id: ${existingProfile.id}`);

      // Verify user_id matches expected
      if (existingProfile.id !== expectedUserId) {
        console.warn(`⚠️  Warning: Existing user_id (${existingProfile.id}) doesn't match expected (${expectedUserId})`);
        console.warn(`   Using existing user_id: ${existingProfile.id}`);
      }

      // Check if owner Person exists
      console.log('\n📋 Checking for owner Person node...');
      const ownerPerson = await personRepository.findOwner(existingProfile.id);

      if (ownerPerson) {
        console.log(`✅ Owner Person already exists: ${ownerPerson.entity_key}`);
        console.log(`   Name: ${ownerPerson.name}`);
      } else {
        console.log('❌ Owner Person not found, creating...');
        const normalizedName = displayName.toLowerCase().trim();
        const createdPerson = await personRepository.findOrCreateOwner(existingProfile.id, displayName);
        console.log(`✅ Created owner Person: ${createdPerson.entity_key}`);
        console.log(`   Name: ${createdPerson.name}`);
      }

      console.log('\n✅ Setup complete! User already exists.');
      console.log(`   User ID: ${existingProfile.id}`);
      console.log(`   Display Name: ${displayName}`);

      return {
        userId: existingProfile.id,
        displayName,
        normalizedName: displayName.toLowerCase().trim(),
        isNewUser: false,
      };
    }

    // Step 2: Create new user via auth service
    console.log('❌ Device not found, creating new user...');
    console.log('\n📝 Creating Supabase auth user and profile...');

    const authResult = await authService.registerOrAuthenticateDevice(deviceId);

    console.log(`✅ Created Supabase user: ${authResult.user_id}`);

    // Verify user_id matches expected
    if (authResult.user_id !== expectedUserId) {
      console.warn(`⚠️  Warning: Created user_id (${authResult.user_id}) doesn't match expected (${expectedUserId})`);
      console.warn(`   This is normal - Supabase generates UUIDs automatically.`);
      console.warn(`   You should use the actual user_id: ${authResult.user_id}`);
    }

    // Step 3: Verify owner Person was created (authService should have done this)
    console.log('\n📋 Verifying owner Person node...');
    const ownerPerson = await personRepository.findOwner(authResult.user_id);

    if (!ownerPerson) {
      console.log('❌ Owner Person not found (unexpected), creating...');
      const createdPerson = await personRepository.findOrCreateOwner(authResult.user_id, displayName);
      console.log(`✅ Created owner Person: ${createdPerson.entity_key}`);
      console.log(`   Name: ${createdPerson.name}`);
    } else {
      console.log(`✅ Owner Person verified: ${ownerPerson.entity_key}`);
      console.log(`   Name: ${ownerPerson.name}`);
    }

    console.log('\n✅ Setup complete! New user created.');
    console.log(`   User ID: ${authResult.user_id}`);
    console.log(`   Display Name: ${displayName}`);
    console.log(`   Access Token: ${authResult.access_token.substring(0, 20)}...`);

    return {
      userId: authResult.user_id,
      displayName,
      normalizedName: displayName.toLowerCase().trim(),
      isNewUser: authResult.is_new_user,
      accessToken: authResult.access_token,
    };
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    throw error;
  } finally {
    // Close Neo4j connection
    await neo4jService.close();
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const config: SetupConfig = {};

  // Parse --user-id flag
  const userIdIndex = args.indexOf('--user-id');
  if (userIdIndex !== -1 && args[userIdIndex + 1]) {
    config.userId = args[userIdIndex + 1];
  }

  // Parse --display-name flag
  const displayNameIndex = args.indexOf('--display-name');
  if (displayNameIndex !== -1 && args[displayNameIndex + 1]) {
    config.displayName = args[displayNameIndex + 1];
  }

  // Parse --device-id flag
  const deviceIdIndex = args.indexOf('--device-id');
  if (deviceIdIndex !== -1 && args[deviceIdIndex + 1]) {
    config.deviceId = args[deviceIdIndex + 1];
  }

  setupCanonicalUser(config)
    .then((result) => {
      console.log('\n📊 Setup Results:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { DEFAULT_DEVICE_ID, DEFAULT_DISPLAY_NAME, DEFAULT_USER_ID, setupCanonicalUser };

