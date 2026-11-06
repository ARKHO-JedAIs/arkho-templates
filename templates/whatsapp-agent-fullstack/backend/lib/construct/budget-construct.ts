import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { ParamsConfig } from '../stack/shared/util/env-config';

export interface BudgetConstructProps {
  params: ParamsConfig;
  monthlyLimitUsd: number;
  alertEmails: string[];
  alertPhoneNumbers?: string[];
}

export class BudgetConstruct extends Construct {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: BudgetConstructProps) {
    super(scope, id);

    const { params, monthlyLimitUsd, alertEmails, alertPhoneNumbers = [] } = props;
    const prefix = `${params.projectName}-${params.envName}`;
    const dailyLimitUsd = Math.ceil(monthlyLimitUsd / 10);

    this.alertTopic = new sns.Topic(this, 'BudgetAlertTopic', {
      topicName: `${prefix}-budget-alerts`,
    });

    alertEmails.forEach(email => {
      this.alertTopic.addSubscription(new subscriptions.EmailSubscription(email));
    });

    alertPhoneNumbers.forEach(phone => {
      this.alertTopic.addSubscription(new subscriptions.SmsSubscription(phone));
    });

    const snsSubscriber = {
      subscriptionType: 'SNS' as const,
      address: this.alertTopic.topicArn,
    };

    const allSubscribers = [
      ...alertEmails.map(email => ({
        subscriptionType: 'EMAIL' as const,
        address: email,
      })),
      snsSubscriber,
    ];

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${prefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyLimitUsd,
          unit: 'USD',
        },
        costFilters: {
          TagKeyValue: [`user:Project$${params.projectName}`],
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 50,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
      ],
    });

    new budgets.CfnBudget(this, 'DailyBudget', {
      budget: {
        budgetName: `${prefix}-daily`,
        budgetType: 'COST',
        timeUnit: 'DAILY',
        budgetLimit: {
          amount: dailyLimitUsd,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: allSubscribers,
        },
      ],
    });

    const anomalyMonitor = new ce.CfnAnomalyMonitor(this, 'AnomalyMonitor', {
      monitorName: `${prefix}-service-anomaly`,
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });

    new ce.CfnAnomalySubscription(this, 'AnomalySubscription', {
      subscriptionName: `${prefix}-anomaly-alerts`,
      monitorArnList: [anomalyMonitor.attrMonitorArn],
      subscribers: [
        ...alertEmails.map(email => ({
          address: email,
          type: 'EMAIL' as const,
        })),
        {
          address: this.alertTopic.topicArn,
          type: 'SNS' as const,
        },
      ],
      threshold: 10,
      frequency: 'DAILY',
    });
  }
}
