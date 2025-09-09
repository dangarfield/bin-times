#!/bin/bash

# AWS CLI deployment script for Bin Collection Scraper
# This script uses direct AWS CLI commands to deploy the Lambda function
set -e

echo "🚀 Deploying Bin Collection Scraper with AWS CLI"
echo "================================================="

# Load environment variables if .env exists
if [ -f ".env" ]; then
    # Use grep and eval to safely load variables, ignoring comments and handling spaces
    while IFS= read -r line; do
        # Skip comments and empty lines
        if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
            continue
        fi
        # Export the variable
        if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            export "${BASH_REMATCH[1]}"="${BASH_REMATCH[2]}"
        fi
    done < .env
    echo "✅ Loaded configuration from .env"
else
    echo "❌ .env file not found. Please create one with your configuration."
    exit 1
fi

# Configuration
FUNCTION_NAME="bin-collection-scraper"
REGION=${AWS_REGION:-"eu-west-1"}
PROFILE=${AWS_PROFILE:-"your-profile"}
LAYER_ARN=${CHROMIUM_LAYER_ARN:-"arn:aws:lambda:eu-west-1:764866452798:layer:chrome-aws-lambda:50"}
ROLE_NAME="lambda-execution-role"

echo "📋 Configuration:"
echo "   Function Name: $FUNCTION_NAME"
echo "   AWS Profile: $PROFILE"
echo "   Region: $REGION"
echo "   Layer ARN: $LAYER_ARN"
echo ""

# Check if AWS CLI is configured with the profile
if ! aws sts get-caller-identity --profile $PROFILE > /dev/null 2>&1; then
    echo "❌ AWS CLI not configured for profile '$PROFILE'"
    echo "   Please run: aws configure sso --profile $PROFILE"
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile $PROFILE --query Account --output text)
echo "🏢 AWS Account: $ACCOUNT_ID"

# Check if basic Lambda execution role exists, create if not
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
if ! aws iam get-role --role-name $ROLE_NAME --profile $PROFILE > /dev/null 2>&1; then
    echo "🔨 Creating Lambda execution role..."
    
    # Create trust policy
    cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

    # Create the role
    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file://trust-policy.json \
        --profile $PROFILE > /dev/null

    # Attach basic Lambda execution policy
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
        --profile $PROFILE

    # Wait for role to be ready
    echo "⏳ Waiting for role to be ready..."
    sleep 10
    
    rm trust-policy.json
    echo "✅ Created Lambda execution role"
else
    echo "✅ Lambda execution role already exists"
fi

# Install Lambda dependencies
echo "📦 Installing Lambda dependencies..."
cd lambda
npm install --omit=dev
cd ..

# Create deployment package (include minimal dependencies)
echo "📦 Creating deployment package..."
cd lambda
zip -r ../lambda-code.zip . \
    -x "package-lock.json" \
    -x "*.bak.js"
cd ..

echo "✅ Created deployment package: lambda-code.zip"

# Check package size
PACKAGE_SIZE=$(du -h lambda-code.zip | cut -f1)
echo "📏 Package size: $PACKAGE_SIZE"

# Create or update Lambda function
if aws lambda get-function --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION > /dev/null 2>&1; then
    echo "🔄 Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda-code.zip \
        --profile $PROFILE \
        --region $REGION > /dev/null
    
    # Wait for code update to complete
    echo "⏳ Waiting for code update to complete..."
    aws lambda wait function-updated \
        --function-name $FUNCTION_NAME \
        --profile $PROFILE \
        --region $REGION
    
    # Update configuration
    echo "🔧 Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --timeout 30 \
        --memory-size 2048 \
        --layers $LAYER_ARN \
        --environment Variables="{ADDRESS=\"$ADDRESS\",CLIENT_EMAIL=\"$CLIENT_EMAIL\",PRIVATE_KEY=\"$PRIVATE_KEY\",CALENDAR_ID=\"$CALENDAR_ID\"}" \
        --profile $PROFILE \
        --region $REGION > /dev/null
    
    echo "✅ Updated Lambda function"
else
    echo "🆕 Creating new Lambda function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role $ROLE_ARN \
        --handler scraper.handler \
        --zip-file fileb://lambda-code.zip \
        --timeout 30 \
        --memory-size 2048 \
        --layers $LAYER_ARN \
        --environment Variables="{ADDRESS=\"$ADDRESS\",CLIENT_EMAIL=\"$CLIENT_EMAIL\",PRIVATE_KEY=\"$PRIVATE_KEY\",CALENDAR_ID=\"$CALENDAR_ID\"}" \
        --profile $PROFILE \
        --region $REGION > /dev/null
    
    echo "✅ Created Lambda function"
fi

# Create Function URL if it doesn't exist
echo "🌐 Setting up Function URL..."
if ! aws lambda get-function-url-config --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION > /dev/null 2>&1; then
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name $FUNCTION_NAME \
        --auth-type NONE \
        --profile $PROFILE \
        --region $REGION \
        --query FunctionUrl --output text)
    echo "✅ Created Function URL: $FUNCTION_URL"
else
    FUNCTION_URL=$(aws lambda get-function-url-config \
        --function-name $FUNCTION_NAME \
        --profile $PROFILE \
        --region $REGION \
        --query FunctionUrl --output text)
    echo "✅ Function URL already exists: $FUNCTION_URL"
fi

# Create EventBridge rule for daily schedule
echo "📅 Setting up daily schedule..."
RULE_NAME="bin-collection-daily"
aws events put-rule \
    --name $RULE_NAME \
    --schedule-expression "cron(0 1 * * ? *)" \
    --description "Trigger bin collection scraper daily at 1 AM UTC" \
    --profile $PROFILE \
    --region $REGION > /dev/null

# Add permission for EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id bin-collection-schedule \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:$REGION:$ACCOUNT_ID:rule/$RULE_NAME \
    --profile $PROFILE \
    --region $REGION > /dev/null 2>&1 || echo "   (Permission already exists)"

# Add Lambda as target for EventBridge rule
aws events put-targets \
    --rule $RULE_NAME \
    --targets "Id"="1","Arn"="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME" \
    --profile $PROFILE \
    --region $REGION > /dev/null

echo "✅ Created daily schedule (1 AM UTC)"

# Clean up
rm lambda-code.zip

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Summary:"
echo "   ✅ Function: $FUNCTION_NAME"
echo "   ✅ Region: $REGION"
echo "   ✅ Runtime: Node.js 18.x"
echo "   ✅ Memory: 2048 MB"
echo "   ✅ Timeout: 30 seconds"
echo "   ✅ Layer: Chromium Lambda Layer"
echo "   ✅ Schedule: Daily at 1 AM UTC"
echo "   ✅ Function URL: $FUNCTION_URL"
echo ""
echo "🧪 Test the function:"
echo "   curl -X POST $FUNCTION_URL"
echo ""
echo "📊 View logs:"
echo "   aws logs tail /aws/lambda/$FUNCTION_NAME --follow --profile $PROFILE --region $REGION"
echo ""
echo "🗑️ To remove everything:"
echo "   aws lambda delete-function --function-name $FUNCTION_NAME --profile $PROFILE --region $REGION"
echo "   aws events remove-targets --rule $RULE_NAME --ids 1 --profile $PROFILE --region $REGION"
echo "   aws events delete-rule --name $RULE_NAME --profile $PROFILE --region $REGION"