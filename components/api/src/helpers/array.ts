export function combine<T>(
  array: T[],
  item: T,
  isMatch: (a: T, b: T) => boolean,
  merge: (existing: T, newItem: T) => T,
): T[] {
  const index = array.findIndex((existing) => isMatch(existing, item));

  if (index === -1) {
    // Si l'élément n'existe pas, on l'ajoute à la fin du tableau
    return [...array, item];
  }

  // Si l'élément existe, on le fusionne avec l'élément existant
  const newArray = [...array];
  newArray[index] = merge(array[index], item);

  return newArray;
}
