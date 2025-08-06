#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
require('dotenv').config({ path: '../.env' });

class BinTimesStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'BinTimesLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add Name tag to the role
    cdk.Tags.of(lambdaRole).add('Name', 'dg-test');

    // Read the Lambda function code directly
    const lambdaCodePath = path.join(__dirname, '../lambda-src/index.js');
    const lambdaCode = fs.readFileSync(lambdaCodePath, 'utf8');

    // Create Lambda function with inline code (no assets required)
    const binTimesFunction = new lambda.Function(this, 'BinTimesFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(lambdaCode),
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      role: lambdaRole,
      environment: {
        ADDRESS: process.env.ADDRESS || '243 Cambridge Road Hitchin SG4 0JS',
        CLIENT_EMAIL: process.env.CLIENT_EMAIL || '',
        PRIVATE_KEY: process.env.PRIVATE_KEY || '',
        CALENDAR_ID: process.env.CALENDAR_ID || '',
      },
      functionName: 'dg-test-bin-times-scraper',
    });

    // Add Name tag to the Lambda function
    cdk.Tags.of(binTimesFunction).add('Name', 'dg-test');

    // Create EventBridge rule to run daily at 6 AM
    const dailyRule = new events.Rule(this, 'DailyBinTimesRule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '6',
        day: '*',
        month: '*',
        year: '*',
      }),
      ruleName: 'dg-test-bin-times-daily',
    });

    // Add Name tag to the EventBridge rule
    cdk.Tags.of(dailyRule).add('Name', 'dg-test');

    // Add Lambda function as target
    dailyRule.addTarget(new targets.LambdaFunction(binTimesFunction));

    // Outputs
    new cdk.CfnOutput(this, 'BinTimesFunctionArn', {
      value: binTimesFunction.functionArn,
      description: 'ARN of the Bin Times Lambda function',
    });

    new cdk.CfnOutput(this, 'BinTimesFunctionName', {
      value: binTimesFunction.functionName,
      description: 'Name of the Bin Times Lambda function',
    });

    new cdk.CfnOutput(this, 'DailyRuleArn', {
      value: dailyRule.ruleArn,
      description: 'ARN of the daily EventBridge rule',
    });
  }
}

const app = new cdk.App();

new BinTimesStack(app, 'DgTestBinTimesStack', {
  env: {
    account: '079514346660',
    region: 'eu-west-1',
  },
  stackName: 'dg-test-bin-times-stack',
  tags: {
    Name: 'dg-test',
    Project: 'bin-times-scraper',
  },
});

app.synth();
