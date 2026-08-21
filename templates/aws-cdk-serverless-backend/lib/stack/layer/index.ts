import { Construct } from 'constructs';
import { LayerConstruct } from '../../construct/layer-construct';
import { ParamsConfig } from '../shared/util/env-config';

export interface LayerFactoryProps {
  params: ParamsConfig;
}

/**
 * Centralized factory for the Lambda layers.
 *
 * Builds the python-common layer from src/layer/python-common (logging,
 * standardized responses, and CORS helpers shared by the Python functions).
 */
export class LayerFactory extends Construct {
  public readonly pythonCommonLayer: LayerConstruct;

  constructor(scope: Construct, id: string, props: LayerFactoryProps) {
    super(scope, id);

    const { params } = props;

    this.pythonCommonLayer = LayerConstruct.createPythonCommonLayer(this, 'PythonCommonLayer', params);
  }
}
