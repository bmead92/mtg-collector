let ids: number[] = [];

export const setBrowseList = (list: number[]) => {
  ids = list;
};

export const browseListFor = (id: number) => (ids.includes(id) ? ids : [id]);
