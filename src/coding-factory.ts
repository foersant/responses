import {
  ResponseValueType, VariableCodingData, VariableInfo, Response, ValueTransformation
} from './coding-interfaces';

export abstract class CodingFactory {
  static createCodingVariableFromVarInfo(varInfo: VariableInfo): VariableCodingData {
    return <VariableCodingData>{
      id: varInfo.id,
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
      valueTransformations: [],
      manualInstruction: '',
      codeModel: null,
      codeModelParameters: [],
      codes: []
    };
  }

  static deriveValue(coding: VariableCodingData, allResponses: Response[]): ResponseValueType {
    // raises exceptions if deriving fails
    // ensure before, that sourceType is not 'BASE' and there are enough valid sources
    // eslint-disable-next-line default-case
    switch (coding.sourceType) {
      case 'CONCAT_CODE':
        return allResponses.filter(r => coding.deriveSources.indexOf(r.id) >= 0)
          .map(r => (r.code ? r.code.toString() : ''))
          .join('_');
      case 'SUM_CODE':
        return allResponses.filter(r => coding.deriveSources.indexOf(r.id) >= 0)
          .map(r => (r.code ? r.code : 0))
          .reduce((sum, current) => sum + current, 0);
      case 'SUM_SCORE':
        return allResponses.filter(r => coding.deriveSources.indexOf(r.id) >= 0)
          .map(r => (r.score ? r.score : 0))
          .reduce((sum, current) => sum + current, 0);
    }
    throw new TypeError('deriving failed');
  }

  private static transformValue(value: ResponseValueType, transformations: ValueTransformation[]): ResponseValueType {
    // raises exceptions if transformation fails
    const stringifiedValue = JSON.stringify(value);
    let newValue = JSON.parse(stringifiedValue);
    if (typeof newValue === 'string' && transformations && transformations.length > 0) {
      if (transformations.indexOf('TO_UPPER') >= 0) {
        newValue = newValue.toUpperCase();
      }
      if (transformations.indexOf('REMOVE_WHITE_SPACES') >= 0) {
        newValue = newValue.trim();
      }
      if (transformations.indexOf('TO_NUMBER') >= 0) {
        newValue = Number.parseFloat(newValue.replace(',', '.'));
        if (Number.isNaN(newValue)) {
          throw new TypeError('response value type conversion to number failed');
        }
      }
    }
    return newValue;
  }

  private static findString(value: ResponseValueType, parameters: string[] = []): boolean {
    if (typeof value === 'string' && value.length > 0) {
      let allStrings: string[] = [];
      parameters.forEach(p => {
        allStrings = allStrings.concat(p.split('\n'));
      });
      return allStrings.indexOf(value as string) >= 0;
    }
    return false;
  }

  private static findStringRegEx(value: ResponseValueType, parameters: string[] = []): boolean {
    if (typeof value === 'string' && value.length > 0) {
      let allStrings: string[] = [];
      parameters.forEach(p => {
        allStrings = allStrings.concat(p.split('\n'));
      });
      const trueCases = allStrings.map((s: string): boolean => {
        const regEx = new RegExp(s);
        return !!regEx.exec(value);
      }).filter(found => found);
      return trueCases.length > 0;
    }
    return false;
  }

  static code(response: Response, coding: VariableCodingData): Response {
    const stringifiedResponse = JSON.stringify(response);
    const newResponse = JSON.parse(stringifiedResponse);
    if (coding && coding.codes.length > 0 && !Array.isArray(newResponse.value)) {
      let valueToCheck: ResponseValueType;
      try {
        valueToCheck = this.transformValue(newResponse.value, coding.valueTransformations);
      } catch (e) {
        newResponse.status = 'CODING_ERROR';
        valueToCheck = null;
      }
      if (newResponse.status !== 'CODING_ERROR') {
        let hasElse = false;
        let elseCode = 0;
        let elseScore = 0;
        let changed = false;
        coding.codes.forEach(c => {
          if (!changed) {
            c.rules.forEach(r => {
              if (!changed) {
                // eslint-disable-next-line default-case
                switch (r.method) {
                  case 'ELSE':
                    hasElse = true;
                    elseCode = c.id;
                    elseScore = c.score;
                    break;
                  case 'IS_NULL':
                    if (valueToCheck === null) {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'IS_EMPTY':
                    if (valueToCheck === '') {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'MATCH':
                    if (this.findString(valueToCheck, r.parameters)) {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'MATCH_REGEX':
                    if (this.findStringRegEx(valueToCheck, r.parameters)) {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_LESS_THEN':
                    if (typeof valueToCheck === 'number' && r.parameters) {
                      const valueAsNumeric = valueToCheck as number;
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (valueAsNumeric < compareValue) {
                        newResponse.code = c.id;
                        newResponse.score = c.score;
                        newResponse.status = 'CODING_COMPLETE';
                        changed = true;
                      }
                    } else {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_MAX':
                    if (typeof valueToCheck === 'number' && r.parameters) {
                      const valueAsNumeric = valueToCheck as number;
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (valueAsNumeric <= compareValue) {
                        newResponse.code = c.id;
                        newResponse.score = c.score;
                        newResponse.status = 'CODING_COMPLETE';
                        changed = true;
                      }
                    } else {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_MORE_THEN':
                    if (typeof valueToCheck === 'number' && r.parameters) {
                      const valueAsNumeric = valueToCheck as number;
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (valueAsNumeric > compareValue) {
                        newResponse.code = c.id;
                        newResponse.score = c.score;
                        newResponse.status = 'CODING_COMPLETE';
                        changed = true;
                      }
                    } else {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_MIN':
                    if (typeof valueToCheck === 'number' && r.parameters) {
                      const valueAsNumeric = valueToCheck as number;
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (valueAsNumeric >= compareValue) {
                        newResponse.code = c.id;
                        newResponse.score = c.score;
                        newResponse.status = 'CODING_COMPLETE';
                        changed = true;
                      }
                    } else {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_RANGE':
                    if (typeof valueToCheck === 'number' && r.parameters) {
                      const valueAsNumeric = valueToCheck as number;
                      const compareValueLL = Number.parseFloat(r.parameters[0]);
                      const compareValueUL = Number.parseFloat(r.parameters[1]);
                      if (valueAsNumeric > compareValueLL && valueAsNumeric <= compareValueUL) {
                        newResponse.code = c.id;
                        newResponse.score = c.score;
                        newResponse.status = 'CODING_COMPLETE';
                        changed = true;
                      }
                    } else {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                }
              }
            });
          }
        });
        if (!changed) {
          if (hasElse) {
            newResponse.code = elseCode;
            newResponse.score = elseScore;
            newResponse.status = 'CODING_COMPLETE';
            changed = true;
          } else {
            newResponse.code = 0;
            newResponse.score = 0;
            newResponse.status = 'CODING_INCOMPLETE';
            changed = true;
          }
        }
      }
    } else {
      newResponse.status = 'NO_CODING';
    }
    return newResponse;
  }
}
