#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '../.env' });

const STACK_NAME = 'dg-test-bin-times-stack';
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

function createCloudFormationTemplate() {
  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Bin Times Scraper Lambda Function with EventBridge Scheduling',
    
    Resources: {
      BinTimesLambdaRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole'
            }]
          },
          ManagedPolicyArns: [
            'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
          ],
          Tags: [{ Key: 'Name', Value: 'dg-test' }]
        }
      },
      
      BinTimesFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: 'dg-test-bin-times-scraper',
          Runtime: 'nodejs18.x',
          Handler: 'index.handler',
          Role: { 'Fn::GetAtt': ['BinTimesLambdaRole', 'Arn'] },
          Timeout: 120,
          MemorySize: 1024,
          Environment: {
            Variables: {
              ADDRESS: process.env.ADDRESS || '243 Cambridge Road Hitchin SG4 0JS',
              CLIENT_EMAIL: process.env.CLIENT_EMAIL || '',
              PRIVATE_KEY: process.env.PRIVATE_KEY || '',
              CALENDAR_ID: process.env.CALENDAR_ID || ''
            }
          },
          Code: {
            ZipFile: fs.readFileSync(path.join(__dirname, '../lambda-src/index.js'), 'utf8')
          },
          Tags: [{ Key: 'Name', Value: 'dg-test' }]
        },
        DependsOn: 'BinTimesLambdaRole'
      },
      
      DailyBinTimesRule: {
        Type: 'AWS::Events::Rule',
        Properties: {
          Name: 'dg-test-bin-times-daily',
          Description: 'Run bin times scraper daily at 6 AM',
          ScheduleExpression: 'cron(0 6 * * ? *)',
          State: 'ENABLED',
          Targets: [{
            Id: 'BinTimesLambdaTarget',
            Arn: { 'Fn::GetAtt': ['BinTimesFunction', 'Arn'] }
          }]
        }
      },
      
      LambdaInvokePermission: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          Action: 'lambda:InvokeFunction',
          FunctionName: { Ref: 'BinTimesFunction' },
          Principal: 'events.amazonaws.com',
          SourceArn: { 'Fn::GetAtt': ['DailyBinTimesRule', 'Arn'] }
        }
      }
    },
    
    Outputs: {
      BinTimesFunctionArn: {
        Description: 'ARN of the Bin Times Lambda function',
        Value: { 'Fn::GetAtt': ['BinTimesFunction', 'Arn'] }
      },
      BinTimesFunctionName: {
        Description: 'Name of the Bin Times Lambda function',
        Value: { Ref: 'BinTimesFunction' }
      },
      DailyRuleArn: {
        Description: 'ARN of the daily EventBridge rule',
        Value: { 'Fn::GetAtt': ['DailyBinTimesRule', 'Arn'] }
      },
      LambdaRoleName: {
        Description: 'Name of the Lambda execution role',
        Value: { Ref: 'BinTimesLambdaRole' }
      }
    }
  };
  
  const templatePath = path.join(__dirname, 'cloudformation-template.json');
  fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
  console.log('✅ CloudFormation template created');
  
  return templatePath;
}

function cleanupExistingResources() {
  console.log('\n🧹 Cleaning up existing resources...');
  
  // Delete existing Lambda function if it exists
  try {
    runCommand(
      `aws lambda delete-function --profile ${PROFILE} --region ${REGION} --function-name dg-test-bin-times-scraper`,
      'Deleting existing Lambda function'
    );
  } catch (error) {
    console.log('Lambda function does not exist or already deleted');
  }
  
  // Delete existing EventBridge rule if it exists
  try {
    // First remove targets
    runCommand(
      `aws events remove-targets --profile ${PROFILE} --region ${REGION} --rule dg-test-bin-times-daily --ids BinTimesLambdaTarget`,
      'Removing EventBridge rule targets'
    );
  } catch (error) {
    console.log('EventBridge rule targets do not exist');
  }
  
  try {
    runCommand(
      `aws events delete-rule --profile ${PROFILE} --region ${REGION} --name dg-test-bin-times-daily`,
      'Deleting existing EventBridge rule'
    );
  } catch (error) {
    console.log('EventBridge rule does not exist or already deleted');
  }
  
  console.log('✅ Cleanup completed');
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

function deployStack(templatePath) {
  console.log('\n🚀 Deploying CloudFormation stack...');
  
  runCommand(
    `aws cloudformation create-stack --profile ${PROFILE} --region ${REGION} \\
      --stack-name ${STACK_NAME} \\
      --template-body file://${templatePath} \\
      --capabilities CAPABILITY_IAM \\
      --tags Key=Name,Value=dg-test Key=Project,Value=bin-times-scraper`,
    'Creating CloudFormation stack'
  );
  
  // Wait for stack to complete
  runCommand(
    `aws cloudformation wait stack-create-complete --profile ${PROFILE} --region ${REGION} --stack-name ${STACK_NAME}`,
    'Waiting for stack deployment to complete'
  );
}

function updateLambdaCode() {
  console.log('\n📝 Updating Lambda function code...');
  
  runCommand(
    `aws lambda update-function-code --profile ${PROFILE} --region ${REGION} \\
      --function-name dg-test-bin-times-scraper \\
      --zip-file fileb://function.zip`,
    'Updating Lambda function code'
  );
}

function main() {
  console.log('🚀 Starting direct CloudFormation deployment...');
  
  try {
    // Step 1: Clean up existing resources
    cleanupExistingResources();
    
    // Step 2: Create CloudFormation template
    const templatePath = createCloudFormationTemplate();
    
    // Step 3: Deploy infrastructure
    deployStack(templatePath);
    
    // Step 4: Create optimized package
    const packageSize = createOptimizedPackage();
    
    // Step 5: Update Lambda code
    updateLambdaCode();
    
    // Clean up
    execSync('rm -f function.zip cloudformation-template.json');
    
    console.log('\n🎉 Deployment completed successfully!');
    console.log(`\n📋 Resources deployed:`);
    console.log(`   • Lambda Function: dg-test-bin-times-scraper`);
    console.log(`   • IAM Role: (CloudFormation generated name)`);
    console.log(`   • EventBridge Rule: dg-test-bin-times-daily`);
    console.log(`   • Region: ${REGION}`);
    console.log(`   • Package size: ${packageSize.toFixed(2)} MB`);
    console.log(`   • All resources tagged with Name=dg-test`);
    
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    
    // Clean up on failure
    if (fs.existsSync('./function.zip')) {
      execSync('rm -f function.zip');
    }
    if (fs.existsSync('./cloudformation-template.json')) {
      execSync('rm -f cloudformation-template.json');
    }
    
    process.exit(1);
  }
}

main();
