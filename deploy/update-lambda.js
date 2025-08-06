#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FUNCTION_NAME = 'dg-test-bin-times-scraper';
const PROFILE = 'dan-sso';
const REGION = 'eu-west-1';

function runCommand(command, description) {
  console.log(`\n${description}...`);
  try {
    const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    console.log('✅ Success');
    return result;
  } catch (error) {
    if (error.stdout) console.log('Output:', error.stdout);
    if (error.stderr) console.log('Error:', error.stderr);
    throw error;
  }
}

function createOptimizedPackage() {
  console.log('\n📦 Creating optimized Lambda package...');

  const lambdaSrcPath = path.join(__dirname, '../lambda-src');
  const packagePath = path.join(__dirname, 'lambda-package');
  const zipPath = path.join(__dirname, 'function.zip');

  // Clean up any existing package
  if (fs.existsSync(packagePath)) {
    execSync(`rm -rf ${packagePath}`);
  }
  if (fs.existsSync(zipPath)) {
    execSync(`rm -f ${zipPath}`);
  }

  // Create package directory
  fs.mkdirSync(packagePath);

  // Copy Lambda source files
  execSync(`cp -r ${lambdaSrcPath}/* ${packagePath}/`);

  // Install production dependencies
  console.log('📥 Installing production dependencies...');
  execSync('npm install --production', { 
    cwd: packagePath, 
    stdio: 'inherit' 
  });

  // Optimize package size
  console.log('🧹 Optimizing package size...');
  const optimizations = [
    'find node_modules -name "*.md" -delete',
    'find node_modules -name "test" -type d -exec rm -rf {} + 2>/dev/null || true',
    'find node_modules -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true',
    'find node_modules -name "example" -type d -exec rm -rf {} + 2>/dev/null || true',
    'find node_modules -name "examples" -type d -exec rm -rf {} + 2>/dev/null || true',
    'find node_modules -name "*.d.ts" -delete',
    'find node_modules -name "*.map" -delete',
    'find node_modules -name "docs" -type d -exec rm -rf {} + 2>/dev/null || true',
    'find node_modules -name "LICENSE*" -delete',
  ];

  for (const cmd of optimizations) {
    try {
      execSync(cmd, { cwd: packagePath, stdio: 'pipe' });
    } catch (error) {
      // Ignore errors from find commands
    }
  }

  // Create zip file
  console.log('📦 Creating deployment package...');
  execSync(`cd ${packagePath} && zip -r ../function.zip .`);

  // Check package size
  const stats = fs.statSync(zipPath);
  const fileSizeInMB = stats.size / (1024 * 1024);
  console.log(`📦 Package size: ${fileSizeInMB.toFixed(2)} MB`);

  // Clean up temporary directory
  execSync(`rm -rf ${packagePath}`);

  console.log('✅ Lambda package created successfully');
  return fileSizeInMB;
}

function updateLambdaCode() {
  console.log('\n📝 Updating Lambda function code...');
  
  runCommand(
    `aws lambda update-function-code --profile ${PROFILE} --region ${REGION} \\
      --function-name ${FUNCTION_NAME} \\
      --zip-file fileb://function.zip`,
    'Updating Lambda function code'
  );
}

function main() {
  console.log('🚀 Starting Lambda code update...');
  
  try {
    // Create optimized package
    const packageSize = createOptimizedPackage();
    
    // Update Lambda code
    updateLambdaCode();
    
    // Clean up
    execSync('rm -f function.zip');
    
    console.log('\n🎉 Lambda code update completed successfully!');
    console.log(`📦 Package size: ${packageSize.toFixed(2)} MB`);
    
  } catch (error) {
    console.error('\n❌ Update failed:', error.message);
    
    // Clean up on failure
    if (fs.existsSync('./function.zip')) {
      execSync('rm -f function.zip');
    }
    
    process.exit(1);
  }
}

main();
