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
 * the URL surface stays in one place.
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
      routes: [
        // Reference example of the API Gateway -> Lambda wiring. Public on
        // purpose so `curl <api-url>hello-world` verifies the deploy before any
        // Cognito token exists; it returns a static payload and reads nothing.
        // Delete it, or drop `requireAuth: false`, once the API serves real
        // routes.
        {
          path: '/hello-world',
          method: 'GET',
          lambda: lambdaFactory.helloWorldLambda.function,
          requireAuth: false,
        },
        // Protected counterpart: the handler reads the caller from
        // `requestContext.authorizer`, so it only works behind the authorizer.
        // It is also what attaches the authorizer to the API - a TokenAuthorizer
        // that no method references fails synth with "must be attached to a
        // RestApi".
        {
          path: '/presigned-url',
          method: 'GET',
          lambda: lambdaFactory.presignedUrlTemplateLambda.function,
        },
      ],
    });

    // Anything the routes above do not match answers with the standardized 404
    // body from the not-found function instead of API Gateway's default error.
    this.restApi.addNotFoundHandler(lambdaFactory.notFoundLambda.function);
  }
}
