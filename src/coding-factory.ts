import {
  ResponseValueType,
  VariableCodingData,
  VariableInfo,
  Response,
  ProcessingParameterType,
  DeriveConcatDelimiter,
  SourceType,
  CodeData, CodeAsText
} from './coding-interfaces';

export abstract class CodingFactory {
  static createCodingVariableFromVarInfo(varInfo: VariableInfo): VariableCodingData {
    return <VariableCodingData>{
      id: varInfo.id,
      label: '',
      sourceType: 'BASE',
      deriveSources: [],
      processing: [],
      manualInstruction: '',
      codeModel: 'NONE',
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
          .join(DeriveConcatDelimiter);
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

  private static transformValue(value: ResponseValueType, processing: ProcessingParameterType[]): ResponseValueType {
    // raises exceptions if transformation fails
    const stringifiedValue = JSON.stringify(value);
    let newValue = JSON.parse(stringifiedValue);
    if (typeof newValue === 'string' && processing && processing.length > 0) {
      if (processing.indexOf('REMOVE_WHITE_SPACES') >= 0) {
        newValue = newValue.trim();
      }
    }
    return newValue;
  }

  private static findString(value: ResponseValueType, ignoreCase: boolean, parameters: string[] = []): boolean {
    if (typeof value === 'string' && value.length > 0) {
      const allStrings: string[] = [];
      parameters.forEach(p => {
        allStrings.push(...p.split('\n'));
      });
      const stringToCompare = ignoreCase ? (value as string).toUpperCase() : (value as string);
      const inList = allStrings.find(s => stringToCompare === (ignoreCase ? s.toUpperCase() : s));
      return !!inList;
    }
    return false;
  }

  private static findStringRegEx(value: ResponseValueType, parameters: string[] = []): boolean {
    if (typeof value === 'string' && value.length > 0) {
      const allStrings: string[] = [];
      parameters.forEach(p => {
        allStrings.push(...p.split('\n'));
      });
      const trueCases = allStrings.map((s: string): boolean => {
        const regEx = new RegExp(s);
        return !!regEx.exec(value);
      }).filter(found => found);
      return trueCases.length > 0;
    }
    return false;
  }

  static getValueAsNumber(value: ResponseValueType): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return (value as boolean) ? 1 : 0;
    if (typeof value === 'string') {
      const normalizedString = (value as string).replace(',', '.').trim();
      const valueAsString = Number.parseFloat(normalizedString);
      if (Number.isNaN(valueAsString)) return null;
      return valueAsString;
    }
    return null;
  }

  static code(response: Response, coding: VariableCodingData): Response {
    const stringifiedResponse = JSON.stringify(response);
    const newResponse = JSON.parse(stringifiedResponse);
    if (coding && coding.codes.length > 0 && !Array.isArray(newResponse.value)) {
      let valueToCheck: ResponseValueType;
      try {
        valueToCheck = this.transformValue(newResponse.value, coding.processing);
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
                let valueAsNumber: number | null = null;
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
                    if (typeof valueToCheck === 'number') {
                      valueToCheck = valueToCheck.toString(10);
                    } else if (typeof valueToCheck === 'boolean') {
                      valueToCheck = valueToCheck.toString();
                    }
                    if (this.findString(valueToCheck, coding.processing.includes('IGNORE_CASE'), r.parameters)) {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'MATCH_REGEX':
                    if (typeof valueToCheck === 'number') {
                      valueToCheck = valueToCheck.toString(10);
                    } else if (typeof valueToCheck === 'boolean') {
                      valueToCheck = valueToCheck.toString();
                    }
                    if (this.findStringRegEx(valueToCheck, r.parameters)) {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    }
                    break;
                  case 'NUMERIC_LESS_THEN':
                    valueAsNumber = this.getValueAsNumber(valueToCheck);
                    if (typeof valueAsNumber === 'number' && r.parameters) {
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (Number.isNaN(compareValue)) {
                        newResponse.status = 'CODING_ERROR';
                        changed = true;
                      } else if (valueAsNumber < compareValue) {
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
                    valueAsNumber = this.getValueAsNumber(valueToCheck);
                    if (typeof valueAsNumber === 'number' && r.parameters) {
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (Number.isNaN(compareValue)) {
                        newResponse.status = 'CODING_ERROR';
                        changed = true;
                      } else if (valueAsNumber <= compareValue) {
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
                    valueAsNumber = this.getValueAsNumber(valueToCheck);
                    if (typeof valueAsNumber === 'number' && r.parameters) {
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (Number.isNaN(compareValue)) {
                        newResponse.status = 'CODING_ERROR';
                        changed = true;
                      } else if (valueAsNumber > compareValue) {
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
                    valueAsNumber = this.getValueAsNumber(valueToCheck);
                    if (typeof valueAsNumber === 'number' && r.parameters) {
                      const compareValue = Number.parseFloat(r.parameters[0]);
                      if (Number.isNaN(compareValue)) {
                        newResponse.status = 'CODING_ERROR';
                        changed = true;
                      } else if (valueAsNumber >= compareValue) {
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
                    valueAsNumber = this.getValueAsNumber(valueToCheck);
                    if (typeof valueAsNumber === 'number' && r.parameters) {
                      const compareValueLL = Number.parseFloat(r.parameters[0]);
                      const compareValueUL = Number.parseFloat(r.parameters[1]);
                      if (Number.isNaN(compareValueUL) || Number.isNaN(compareValueLL)) {
                        newResponse.status = 'CODING_ERROR';
                        changed = true;
                      } else if (valueAsNumber > compareValueLL && valueAsNumber <= compareValueUL) {
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
                  case 'IS_TRUE':
                    if (valueToCheck === '1' || valueToCheck === true || valueToCheck === 'true') {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    } else if (valueToCheck !== '0' && valueToCheck !== false &&
                        valueToCheck !== 'false' && valueToCheck !== null) {
                      newResponse.status = 'CODING_ERROR';
                      changed = true;
                    }
                    break;
                  case 'IS_FALSE':
                    if (valueToCheck === '0' || valueToCheck === false || valueToCheck === 'false') {
                      newResponse.code = c.id;
                      newResponse.score = c.score;
                      newResponse.status = 'CODING_COMPLETE';
                      changed = true;
                    } else if (valueToCheck !== '1' && valueToCheck !== true &&
                        valueToCheck !== 'true' && valueToCheck !== null) {
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

  static sourceAsText(variableId: string, sourceType: SourceType, sources: string[]): string {
    let returnText;
    switch (sourceType) {
      case 'BASE':
        returnText = `Basisvariable '${variableId}'`;
        break;
      case 'COPY_FIRST_VALUE':
        if (sources && sources.length > 0) {
          returnText = `Kopie von Variable '${sources[0]}'`;
        } else {
          returnText = 'Kopie, aber keine Quelle angegeben';
        }
        break;
      case 'CONCAT_CODE':
        returnText = `Codes von Variablen '${
          sources.join(', ')}' aneinandergehängt mit Trennzeichen '${DeriveConcatDelimiter}'`;
        break;
      case 'SUM_CODE':
        returnText = `Codes von Variablen '${sources.join(', ')}' summiert`;
        break;
      case 'SUM_SCORE':
        returnText = `Scores von Variablen '${sources.join(', ')}' summiert`;
        break;
      default:
        returnText = 'Unbekannte Quelle';
    }
    return returnText;
  }

  static processingAsText(processings: ProcessingParameterType[]): string {
    let returnText = '';
    if (processings && processings.length > 0) {
      returnText = '';
      processings.forEach((t, i) => {
        switch (t) {
          case 'REPLAY_REQUIRED':
            returnText += `${i > 0 ? ', ' : ''
            }Zur Kodierung ist muss die Antwort mit der Aufgabe angezeigt werden (Replay)`;
            break;
          case 'IGNORE_CASE':
            returnText += `${i > 0 ? ', ' : ''}Groß-/Kleinschreibung wird ignoriert`;
            break;
          case 'REMOVE_WHITE_SPACES':
            returnText += `${i > 0 ? ', ' : ''}Entfernen von Leerzeichen vor Kodierung`;
            break;
          case 'ATTACHMENT':
            returnText += `${i > 0 ? ', ' : ''}Zur Kodierung ist eine separate Datei erforderlich (Bild, Audio)`;
            break;
          default:
            returnText += `${i > 0 ? ', ' : ''}?? unbekannter Wer für Prozessparameter`;
        }
      });
    }
    return returnText;
  }

  static codeAsText(code: CodeData): CodeAsText {
    const codeText: CodeAsText = {
      code: code.id,
      score: code.score,
      scoreLabel: '',
      label: code.label,
      hasManualInstruction: !!code.manualInstruction,
      description: ''
    };
    const matchTexts: string[] = [];
    const matchRegexTexts: string[] = [];
    code.rules.forEach(r => {
      let parameterOk = false;
      switch (r.method) {
        case 'MATCH':
          if (r.parameters) {
            r.parameters.forEach(p => {
              matchTexts.push(...p.split('\n'));
            });
          }
          break;
        case 'MATCH_REGEX':
          if (r.parameters) {
            r.parameters.forEach(p => {
              matchRegexTexts.push(...p.split('\n'));
            });
          }
          break;
        case 'NUMERIC_RANGE':
          parameterOk = false;
          if (r.parameters && r.parameters.length === 2) {
            const compareValueLL = Number.parseFloat(r.parameters[0]);
            const compareValueUL = Number.parseFloat(r.parameters[1]);
            if (!Number.isNaN(compareValueLL) && !Number.isNaN(compareValueUL) && compareValueLL < compareValueUL) {
              codeText.description += `${codeText.description.length > 0 ? '; ' : ''
              }Wert ist größer als ${compareValueLL} und kleiner oder gleich ${compareValueUL}`;
              parameterOk = true;
            }
          }
          if (!parameterOk) {
            codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Problem mit Regelparameter`;
          }
          break;
        case 'NUMERIC_LESS_THEN':
          parameterOk = false;
          if (r.parameters && r.parameters.length === 1) {
            const compareValue = Number.parseFloat(r.parameters[0]);
            if (!Number.isNaN(compareValue)) {
              codeText.description += `${codeText.description.length > 0 ? '; ' : ''
              }Wert ist kleiner als ${compareValue}`;
              parameterOk = true;
            }
          }
          if (!parameterOk) {
            codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Problem mit Regelparameter`;
          }
          break;
        case 'NUMERIC_MORE_THEN':
          parameterOk = false;
          if (r.parameters && r.parameters.length === 1) {
            const compareValue = Number.parseFloat(r.parameters[0]);
            if (!Number.isNaN(compareValue)) {
              codeText.description += `${codeText.description.length > 0 ? '; ' : ''
              }Wert ist größer als ${compareValue}`;
              parameterOk = true;
            }
          }
          if (!parameterOk) {
            codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Problem mit Regelparameter`;
          }
          break;
        case 'NUMERIC_MAX':
          parameterOk = false;
          if (r.parameters && r.parameters.length === 1) {
            const compareValue = Number.parseFloat(r.parameters[0]);
            if (!Number.isNaN(compareValue)) {
              codeText.description += `${codeText.description.length > 0 ? '; ' : ''
              }Wert ist maximal gleich ${compareValue}`;
              parameterOk = true;
            }
          }
          if (!parameterOk) {
            codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Problem mit Regelparameter`;
          }
          break;
        case 'NUMERIC_MIN':
          parameterOk = false;
          if (r.parameters && r.parameters.length === 1) {
            const compareValue = Number.parseFloat(r.parameters[0]);
            if (!Number.isNaN(compareValue)) {
              codeText.description += `${codeText.description.length > 0 ? '; ' : ''
              }Wert ist mindestens gleich ${compareValue}`;
              parameterOk = true;
            }
          }
          if (!parameterOk) {
            codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Problem mit Regelparameter`;
          }
          break;
        case 'IS_EMPTY':
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Wert ist leer`;
          break;
        case 'ELSE':
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Alle anderen Werte`;
          break;
        case 'IS_NULL':
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Technischer Wert 'NULL'`;
          break;
        case 'IS_TRUE':
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Logischer Wert 'WAHR'`;
          break;
        case 'IS_FALSE':
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''}Logischer Wert 'FALSCH'`;
          break;
        default:
          codeText.description += `${codeText.description.length > 0 ? '; ' : ''
          }Problem: unbekannte Regel '${r.method}'`;
      }
    });
    if (matchTexts.length > 0) {
      codeText.description += `${codeText.description.length > 0 ? '; ' : ''
      }Übereinstimmung mit: '${matchTexts.join('\', \'')}'`;
    }
    if (matchRegexTexts.length > 0) {
      codeText.description += `${codeText.description.length > 0 ? '; ' : ''
      }Übereinstimmung (match regex) mit: '${matchRegexTexts.join('\', \'')}'`;
    }
    return codeText;
  }
}
