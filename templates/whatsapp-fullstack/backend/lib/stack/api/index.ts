import { Construct } from 'constructs';
import { RestApiConstruct } from '../../construct/rest-api-construct';
import { ParamsConfig } from '../shared/util/env-config';
import { LambdaFactory } from '../lambda';

export interface ApiFactoryProps {
  params: ParamsConfig;
  lambdaFactory: LambdaFactory;
}

/**
 * Centralized factory for the public REST API.
 *
 * Every route is a Lambda proxy integration and is protected by the Lambda
 * authorizer (`src/lambda/core/authorizer`, which validates Cognito JWTs)
 * unless it opts out with `requireAuth: false`. New routes are added here so
 * the URL surface stays in one place; the feature modules (WhatsApp, Users)
 * register theirs through `restApi.addRoute`, and those protected routes are
 * also what attach the authorizer - a TokenAuthorizer no method references
 * fails synth with "must be attached to a RestApi".
 */
export class ApiFactory extends Construct {
  public readonly restApi: RestApiConstruct;

  constructor(scope: Construct, id: string, props: ApiFactoryProps) {
    super(scope, id);

    const { params, lambdaFactory } = props;

    this.restApi = new RestApiConstruct(this, 'RestApi', {
      params,
      authorizerType: 'lambda',
      authorizerFunction: lambdaFactory.authorizerLambda.function,
    });

    // Anything no route matches answers with the standardized 404
    // body from the not-found function instead of API Gateway's default error.
    this.restApi.addNotFoundHandler(lambdaFactory.notFoundLambda.function);
  }
}
