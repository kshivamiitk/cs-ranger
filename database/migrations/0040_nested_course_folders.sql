-- Nested course folders
--
-- Nodes can now form a tree within a module. `folder` nodes are structural only:
-- they are shown in the curriculum, can contain child nodes, but do not count as
-- completable lessons.

alter type node_type add value if not exists 'folder';

alter table nodes
  add column if not exists parent_node_id uuid references nodes(id) on delete cascade;

create index if not exists idx_nodes_module_parent_position
  on nodes(module_id, parent_node_id, position);

create or replace function prevent_node_parent_cycle()
returns trigger
language plpgsql
as $$
declare
  _parent_module uuid;
  _parent_type node_type;
  _cycle_found boolean;
begin
  if new.parent_node_id is null then
    return new;
  end if;

  if new.parent_node_id = new.id then
    raise exception 'A node cannot be its own parent';
  end if;

  select module_id, type into _parent_module, _parent_type
    from nodes
   where id = new.parent_node_id;

  if _parent_module is null then
    raise exception 'Parent node % does not exist', new.parent_node_id;
  end if;

  if _parent_module <> new.module_id then
    raise exception 'Parent node must be in the same module';
  end if;

  if _parent_type <> 'folder'::node_type then
    raise exception 'Parent node must be a folder';
  end if;

  with recursive ancestors as (
    select id, parent_node_id
      from nodes
     where id = new.parent_node_id
    union all
    select n.id, n.parent_node_id
      from nodes n
      join ancestors a on n.id = a.parent_node_id
  )
  select exists(select 1 from ancestors where id = new.id)
    into _cycle_found;

  if _cycle_found then
    raise exception 'Node parent cycle detected';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_node_parent_cycle on nodes;
create trigger trg_prevent_node_parent_cycle
before insert or update of parent_node_id, module_id on nodes
for each row execute function prevent_node_parent_cycle();
