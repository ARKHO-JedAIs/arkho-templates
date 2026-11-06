import { Construct } from "constructs";
import { LambdaFactory } from "../lambda";
import { CognitoFactory } from "../cognito";

export interface SetupProps {
    lambdaFactory: LambdaFactory,
    cognitoFactory: CognitoFactory
}

export class SetupFactory extends Construct {
    constructor(
        scope: Construct,
        id: string,
        props: SetupProps
    ) {
        super(scope, id);

        const { lambdaFactory, cognitoFactory } = props;
        lambdaFactory.authorizerLambda.function.addEnvironment("USER_POOL_ID", cognitoFactory.userPoolId);
        lambdaFactory.authorizerLambda.function.addEnvironment("APP_CLIENT_ID", cognitoFactory.userPoolClientId);
    }
}