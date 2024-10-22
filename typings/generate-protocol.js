const fs = require('fs')

const protocol = require('minecraft-data')('bedrock_1.21.30').protocol

const customTypeMap = {
  byterot: 'number',
  u8: 'number',
  u32: 'number',
  uint8: 'number',
  i8: 'number',
  i16: 'number',
  i32: 'number',
  li16: 'number',
  li32: 'number',
  li64: 'number',
  lu16: 'number',
  lu32: 'number',
  lu64: 'number',
  varint: 'number',
  zigzag32: 'number',
  zigzag64: 'number',
  lf32: 'number',
  lf64: 'number',
  f32: 'number',
  bool: 'boolean',
  pstring: 'string',
  buffer: 'Uint8Array',
  vec3f: '[number, number, number]',
  vec3i: '[number, number, number]',
  uuid: 'string',
  nbt: 'any',
  lnbt: 'any',
  lnbts: 'any',
  slot: 'any',
  varint64: 'number',
  LatinString: 'string',
  ByteArray: 'Uint8Array',
  enum_size_based_on_values_len: 'number',
  nbtLoop: 'any',
  LittleString: 'string',
  restBuffer: 'Uint8Array',
};

const resolvePath = (path, context) => {
  const parts = path.split('/');
  let currentContext = context;
  for (const part of parts) {
    if (part === '..') {
      currentContext = currentContext.parent;
    } else if (part !== '.') {
      currentContext = currentContext[part];
    }
  }
  return currentContext;
};

const parseToTypeScript = (name, structure) => {
  let output = '';

  const parseField = (field, context = {}) => {
    if (typeof field === 'string') {
      return customTypeMap[field] || field;
    }

    if (Array.isArray(field)) {
      const [type, options] = field;
      if (type === 'container') {
        return parseContainer(options, context);
      } else if (type === 'switch') {
        return parseSwitch(options, context);
      } else if (type === 'mapper') {
        return parseMapper(options);
      } else if (type === 'pstring' || type === 'buffer') {
        return parseComplexType(type, options);
      } else if (type === 'array') {
        return parseArray(options, context);
      } else if (type === 'option') {
        return parseOption(options, context);
      } else if (type === 'bitflags') {
        return parseBitflags(options);
      } else if (type === 'encapsulated') {
        return parseEncapsulated(options);
      } else if (type === 'bitfield') {
        return parseBitfield(options);
      } else {
        return parseField(type, context);
      }

    }

    return '';
  };

  const parseBitfield = (options) => {
    flagEntries = options.map((flag, index) => `${flag.name}: number`).join(',\n');    
    return `{\n  ${flagEntries}\n}`;
  };

  const parseEncapsulated = (options) => {
    const { lengthType, type } = options;
    return `${parseField(type)} /* encapsulated (lengthType: ${lengthType}) */`;
  };

  const parseBitflags = (options) => {
    const { type, flags } = options;
    let flagEntries = ''
    if (Array.isArray(flags)) {
      flagEntries = flags.map((flag, index) => `${flag} = ${index}`).join(',\n');
    } else {
      flagEntries = Object.entries(flags)
      .map(([key, value]) => `${key} = ${value}`)
      .join(',\n  ');
    }

    return `{\n  ${flagEntries}\n}`;
  };

  const parseContainer = (fields, parentContext) => {
    let result = '{\n';
    fields.forEach((field) => {
      const fieldContext = { ...parentContext, parent: parentContext, ...field };
      if (field.anon === true) {
        // result += parseField(field.type, fieldContext);
      } else {
        result += `${field.name}: ${parseField(field.type, fieldContext)}\n`;
      }
    });
    result += '}';
    return result;
  };

  const parseSwitch = (options, parentContext) => {

    const { compareTo, fields, default: defaultField } = options;
    const comparisonPath = compareTo.includes('..') || compareTo.includes('/') ? resolvePath(compareTo, parentContext) : compareTo;
    let result = `& (\n`;


    Object.entries(fields).forEach(([condition, type]) => {
      if (condition === 'true') {
        const [parsedType] = comparisonPath.split('.')
        const related = structure[1].find((item) => item.name === parsedType);

        if (related.type === 'bool') {
          result += `| { ${parsedType}: true; ${parentContext.name}: ${parseField(type, parentContext)} }\n`;
        } else if (Array.isArray(related.type)) {
          result += `| { ${comparisonPath}: '${condition}'; ${parentContext.name}: ${parseField(type, parentContext)} }\n`;
        } 
        else {
          const parsed = comparisonPath.split('||')
            .map((path) => {
              const comparisonOptions = path.split('.').slice(1).join('.');
              return related ? `${related.type}.${comparisonOptions}` : path;
            })
            .join(' | ');

          result += `| { ${parsedType}: ${parsed}; ${parentContext.name}: ${parseField(type, parentContext)} }\n`;
        }
      }
      else {
        result += `| { ${comparisonPath}: '${condition}'; ${parentContext.name}: ${parseField(type, parentContext)} }\n`;
      }
    });

    if (defaultField) {
      result += `| ${parseField(defaultField, parentContext)}\n\n`;
    }

    result += ')';

    return result;
  };

  const parseSwitchOld = (options, parentContext) => {

    const { fields, default: defaultField } = options;
    let result = ``;

    Object.entries(fields).forEach(([condition, type], index) => {
      if (index === 0) {
        result += `${parseField(type, parentContext)}`;
      } else {
        result += ` | ${parseField(type, parentContext)}`;
      }
    });

    if (defaultField) {
      result += ` | ${parseField(defaultField, parentContext)}`;
    }

    return result;
  };

  const parseMapper = (fields) => {
    const mappedValues = Object.values(fields.mappings)
      .map((value) => `'${value}'`)
      .join(' | ');
    return mappedValues;
  };

  const parseComplexType = (type) => {
    if (type === 'pstring') return `string`;
    if (type === 'buffer') return `Uint8Array`;
    return '';
  };

  const parseArray = (options, parentContext) => {
    const { type } = options;
    return `${parseField(type, parentContext)}[]`;
  };

  const parseOption = (type, parentContext) => {
    return `${parseField(type, parentContext)} | undefined`;
  }

  output += structure[0] === 'bitflags' ? `export const enum ${name}` : `export type ${name} = `;
  output += parseField(structure);
  output += '\n';

  return output;
};

let typingString = '';

for (const [name, structure] of Object.entries(protocol.types)) {
  try {
    if (typeof structure === 'string' || name === 'string') continue
    typingString += parseToTypeScript(name, structure);
  }
  catch (e) {
    console.error(`Failed to parse ${name}`);
    console.error(e);
    console.error(structure);
    return
  }
}

typingString += '\n\n';

fs.writeFileSync('typings.d.ts', typingString);

console.log('TypeScript definition generated and saved to index.d.ts');
