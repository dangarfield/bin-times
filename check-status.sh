#!/bin/bash

echo "🔍 Bin Collection Scraper Status Check"
echo "====================================="

# Load environment variables
if [ -f ".env" ]; then
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
            continue
        fi
        if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            export "${BASH_REMATCH[1]}"="${BASH_REMATCH[2]}"
        fi
    done < .env
fi

FUNCTION_NAME="bin-collection-scraper"
REGION=${AWS_REGION:-"eu-west-1"}
PROFILE=${AWS_PROFILE:-"your-profile"}

echo "📋 Function: $FUNCTION_NAME"
echo "🌍 Region: $REGION"
echo ""

# Check if function exists and get basic info
echo "📊 Function Status:"
FUNCTION_INFO=$(aws lambda get-function \
    --function-name $FUNCTION_NAME \
    --profile $PROFILE \
    --region $REGION \
    --query '{LastModified:Configuration.LastModified,State:Configuration.State,Runtime:Configuration.Runtime}' \
    --output table 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "$FUNCTION_INFO"
else
    echo "❌ Function not found or error accessing it"
    exit 1
fi

echo ""
echo "⏰ Last Execution Time:"

# Get the most recent log stream
LAST_EVENT=$(aws logs describe-log-streams \
    --log-group-name /aws/lambda/$FUNCTION_NAME \
    --order-by LastEventTime \
    --descending \
    --max-items 1 \
    --profile $PROFILE \
    --region $REGION \
    --query 'logStreams[0].lastEventTime' \
    --output text 2>/dev/null)

if [ "$LAST_EVENT" != "None" ] && [ -n "$LAST_EVENT" ] && [ "$LAST_EVENT" != "null" ]; then
    # Convert timestamp to readable format (macOS date command)
    LAST_RUN_TIME=$((LAST_EVENT / 1000))
    READABLE_DATE=$(date -r $LAST_RUN_TIME '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo "✅ $READABLE_DATE"
    else
        echo "✅ Timestamp: $LAST_EVENT"
    fi
    
    # Calculate time since last run
    CURRENT_TIME=$(date +%s)
    TIME_DIFF=$((CURRENT_TIME - LAST_RUN_TIME))
    
    if [ $TIME_DIFF -lt 3600 ]; then
        MINUTES=$((TIME_DIFF / 60))
        echo "   ($MINUTES minutes ago)"
    elif [ $TIME_DIFF -lt 86400 ]; then
        HOURS=$((TIME_DIFF / 3600))
        echo "   ($HOURS hours ago)"
    else
        DAYS=$((TIME_DIFF / 86400))
        echo "   ($DAYS days ago)"
    fi
else
    echo "❌ No execution logs found"
fi

echo ""
echo "📅 Scheduled Rule Status:"
RULE_STATUS=$(aws events describe-rule \
    --name bin-collection-daily \
    --profile $PROFILE \
    --region $REGION \
    --query '{State:State,ScheduleExpression:ScheduleExpression}' \
    --output table 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "$RULE_STATUS"
else
    echo "❌ Scheduled rule not found"
fi

echo ""
echo "🔍 Recent Logs (last 24 hours):"
echo "================================"
aws logs tail /aws/lambda/$FUNCTION_NAME \
    --since 24h \
    --profile $PROFILE \
    --region $REGION 2>/dev/null || echo "No recent logs found"

echo ""
echo "💡 Tips:"
echo "   • Cron runs daily at 1 AM UTC (cron(0 1 * * ? *))"
echo "   • Use './check-status.sh' anytime to check status"
echo "   • Use './run-prod.sh' to test manually"