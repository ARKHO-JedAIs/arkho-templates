import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

export interface GithubOidcConstructProps {
  params: ParamsConfig;
  githubOrg: string;
  githubRepo: string;
}

export class GithubOidcConstruct extends Construct {
  public readonly role: iam.Role;
  public readonly roleArn: string;

  constructor(scope: Construct, id: string, props: GithubOidcConstructProps) {
    super(scope, id);

    const { params, githubOrg, githubRepo } = props;

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    this.role = new iam.Role(this, 'GithubActionsRole', {
      roleName: `${params.projectName}-${params.envName}-github-actions-cdk-diff`,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubOrg}/${githubRepo}:pull_request`,
        },
      }),
      description: 'Read-only role for CDK diff in GitHub Actions PRs',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudFormationReadOnly',
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackResources',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplate',
        'cloudformation:ListStacks',
        'cloudformation:ListStackResources',
      ],
      resources: ['*'],
    }));

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'CdkBootstrapReadOnly',
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
      ],
      resources: [
        `arn:aws:ssm:*:${cdk.Stack.of(this).account}:parameter/cdk-bootstrap/*`,
      ],
    }));

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'CdkAssetsReadOnly',
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        `arn:aws:s3:::cdk-*-assets-${cdk.Stack.of(this).account}-*`,
        `arn:aws:s3:::cdk-*-assets-${cdk.Stack.of(this).account}-*/*`,
      ],
    }));

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'StsReadOnly',
      effect: iam.Effect.ALLOW,
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    }));

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'CdkBootstrapLookupRole',
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: [
        `arn:aws:iam::${cdk.Stack.of(this).account}:role/cdk-*-lookup-role-*`,
      ],
    }));

    this.roleArn = this.role.roleArn;
  }
}
