const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigrations() {
  console.log('🚀 Starting database setup...');
  
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).sort();

  for (const file of migrationFiles) {
    if (file.endsWith('.sql')) {
      console.log(`📝 Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      try {
        // Split SQL into individual statements and execute them
        const statements = sql.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            const { error } = await supabase.rpc('exec_sql', {
              sql: statement + ';'
            }).single();
            
            if (error) {
              console.error(`❌ Error in ${file}:`, error);
            }
          }
        }
        console.log(`✅ Migration ${file} completed`);
      } catch (error) {
        console.error(`❌ Failed to run ${file}:`, error);
      }
    }
  }

  console.log('✨ Database setup completed!');
  
  // Create initial admin user if needed
  console.log('👤 Creating initial admin user...');
  try {
    const { data: existingUser } = await supabase.auth.admin.getUserByEmail('admin@example.com');
    
    if (!existingUser) {
      const { data: user, error } = await supabase.auth.admin.createUser({
        email: 'admin@example.com',
        password: 'admin123456',
        email_confirm: true
      });

      if (!error && user) {
        // Update user profile to admin role
        await supabase
          .from('user_profiles')
          .update({ role: 'admin', name: 'System Admin' })
          .eq('user_id', user.id);
        
        console.log('✅ Admin user created:');
        console.log('   Email: admin@example.com');
        console.log('   Password: admin123456');
      }
    } else {
      console.log('ℹ️ Admin user already exists');
    }
  } catch (error) {
    console.error('❌ Failed to create admin user:', error);
  }
}

runMigrations().catch(console.error);