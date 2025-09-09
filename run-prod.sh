#!/bin/bash

# Production runner for Bin Collection Scraper
# This script invokes the deployed Lambda function
set -e

echo "🚀 Running Bin Collection Scraper in Production"
echo "==============================================="

# Load environment variables if .env exists
if [ -f ".env" ]; then
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

echo "📋 Configuration:"
echo "   Function Name: $FUNCTION_NAME"
echo "   AWS Profile: $PROFILE"
echo "   Region: $REGION"
echo ""

# Check if AWS CLI is configured with the profile
if ! aws sts get-caller-identity --profile $PROFILE > /dev/null 2>&1; then
    echo "❌ AWS CLI not configured for profile '$PROFILE'"
    echo "   Please run: aws configure sso --profile $PROFILE"
    exit 1
fi

# Get Function URL
echo "🔍 Getting Function URL..."
FUNCTION_URL=$(aws lambda get-function-url-config \
    --function-name $FUNCTION_NAME \
    --profile $PROFILE \
    --region $REGION \
    --query FunctionUrl --output text 2>/dev/null)

if [ -z "$FUNCTION_URL" ] || [ "$FUNCTION_URL" = "None" ]; then
    echo "❌ Function URL not found. Please run deploy-cli.sh first."
    exit 1
fi

echo "✅ Function URL: $FUNCTION_URL"
echo ""

# Invoke the function
echo "🎯 Invoking Lambda function..."
echo "⏳ This may take up to 30 seconds..."
echo ""

# Try Function URL first, fallback to direct AWS CLI invoke
TEMP_FILE=$(mktemp)
HTTP_CODE=$(curl -s -w "%{http_code}" -X POST "$FUNCTION_URL" -o "$TEMP_FILE")
BODY=$(cat "$TEMP_FILE")

# If Function URL fails, use AWS CLI direct invoke
if [ "$HTTP_CODE" != "200" ]; then
    echo "   Function URL failed (HTTP $HTTP_CODE), using AWS CLI direct invoke..."
    rm "$TEMP_FILE"
    
    # Use AWS CLI to invoke the function directly
    INVOKE_RESULT=$(aws lambda invoke \
        --function-name $FUNCTION_NAME \
        --profile $PROFILE \
        --region $REGION \
        --output json \
        response.json 2>&1)
    
    if [ $? -eq 0 ]; then
        HTTP_CODE="200"
        BODY=$(cat response.json)
        rm -f response.json
    else
        HTTP_CODE="500"
        BODY="{\"error\": \"AWS CLI invoke failed: $INVOKE_RESULT\"}"
    fi
else
    rm "$TEMP_FILE"
fi

echo "📊 Response:"
echo "   HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Function executed successfully!"
    echo ""
    echo "📄 Response Body:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo "❌ Function execution failed!"
    echo ""
    echo "📄 Error Response:"
    echo "$BODY"
    echo ""
    echo "🔍 Check logs with:"
    echo "   aws logs tail /aws/lambda/$FUNCTION_NAME --follow --profile $PROFILE --region $REGION"
    exit 1
fi

echo ""
echo "🎉 Production run completed!"
echo ""
echo "📊 View detailed logs:"
echo "   aws logs tail /aws/lambda/$FUNCTION_NAME --follow --profile $PROFILE --region $REGION"